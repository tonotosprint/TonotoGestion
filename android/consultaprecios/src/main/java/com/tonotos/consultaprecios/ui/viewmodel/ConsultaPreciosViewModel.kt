package com.tonotos.consultaprecios.ui.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.tonotos.consultaprecios.data.model.CartItem
import com.tonotos.consultaprecios.data.model.Product
import com.tonotos.consultaprecios.data.model.ProductRequest
import com.tonotos.consultaprecios.data.repository.FirebaseRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class UiState(
    val firebaseProjectId: String = "",
    val isFirebaseConnected: Boolean = false,
    val products: List<Product> = emptyList(),
    val filteredProducts: List<Product> = emptyList(),
    val categories: List<String> = emptyList(),
    val selectedCategory: String? = null,
    val searchQuery: String = "",
    val selectedPriceTier: Int = 1, // 1 = Precio 1, 2 = Precio 2, 3 = Precio 3
    val cartItems: List<CartItem> = emptyList(),
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val successMessage: String? = null,
    val showConfigDialog: Boolean = false,
    val showProductDialog: Boolean = false,
    val editingProduct: Product? = null
)

class ConsultaPreciosViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = FirebaseRepository(application)

    private val _uiState = MutableStateFlow(UiState())
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()

    init {
        val projId = repository.getFirebaseProjectId()
        _uiState.update { it.copy(firebaseProjectId = projId) }
        loadProducts()
    }

    fun loadProducts() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            val result = repository.getProductsFromFirebase()
            result.onSuccess { list ->
                val categoriesList = list.mapNotNull { it.category?.trim() }
                    .filter { it.isNotEmpty() }
                    .distinct()
                    .sorted()

                _uiState.update {
                    it.copy(
                        isLoading = false,
                        products = list,
                        categories = categoriesList,
                        isFirebaseConnected = true
                    )
                }
                applyFilter()
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        isFirebaseConnected = false,
                        errorMessage = err.message
                    )
                }
            }
        }
    }

    fun saveFirebaseProjectId(projectId: String) {
        repository.saveFirebaseProjectId(projectId)
        _uiState.update { it.copy(firebaseProjectId = projectId, showConfigDialog = false) }
        loadProducts()
    }

    fun openConfigDialog() {
        _uiState.update { it.copy(showConfigDialog = true) }
    }

    fun closeConfigDialog() {
        _uiState.update { it.copy(showConfigDialog = false) }
    }

    fun openCreateProductDialog() {
        _uiState.update { it.copy(editingProduct = null, showProductDialog = true) }
    }

    fun openEditProductDialog(product: Product) {
        _uiState.update { it.copy(editingProduct = product, showProductDialog = true) }
    }

    fun closeProductDialog() {
        _uiState.update { it.copy(showProductDialog = false, editingProduct = null) }
    }

    fun saveProduct(request: ProductRequest) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val result = repository.saveProductToFirebase(request)
            result.onSuccess {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        showProductDialog = false,
                        editingProduct = null,
                        successMessage = "¡Producto guardado en Firebase!"
                    )
                }
                loadProducts()
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = err.message ?: "No se pudo guardar el producto"
                    )
                }
            }
        }
    }

    fun setSearchQuery(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
        applyFilter()
    }

    fun setSelectedCategory(cat: String?) {
        val newCat = if (_uiState.value.selectedCategory == cat) null else cat
        _uiState.update { it.copy(selectedCategory = newCat) }
        applyFilter()
    }

    fun setSelectedPriceTier(tier: Int) {
        if (tier in 1..3) {
            _uiState.update { it.copy(selectedPriceTier = tier) }
        }
    }

    private fun applyFilter() {
        val q = _uiState.value.searchQuery.lowercase().trim()
        val cat = _uiState.value.selectedCategory

        val filtered = _uiState.value.products.filter { p ->
            val matchesQuery = q.isEmpty() ||
                    p.name.lowercase().contains(q) ||
                    p.sku.lowercase().contains(q) ||
                    (p.barcode != null && p.barcode.lowercase().contains(q))

            val matchesCategory = cat == null || p.category.equals(cat, ignoreCase = true)

            matchesQuery && matchesCategory
        }

        _uiState.update { it.copy(filteredProducts = filtered) }
    }

    // Cart Management
    fun addToCart(product: Product, quantityToAdd: Double = 1.0, tier: Int = _uiState.value.selectedPriceTier) {
        val currentCart = _uiState.value.cartItems.toMutableList()
        val index = currentCart.indexOfFirst { it.product.id == product.id && it.selectedPriceTier == tier }
        val priceForTier = product.getPriceForTier(tier)

        if (index >= 0) {
            val item = currentCart[index]
            currentCart[index] = item.copy(
                quantity = item.quantity + quantityToAdd,
                customPrice = priceForTier
            )
        } else {
            currentCart.add(
                CartItem(
                    product = product,
                    quantity = quantityToAdd,
                    selectedPriceTier = tier,
                    customPrice = priceForTier
                )
            )
        }
        _uiState.update {
            it.copy(
                cartItems = currentCart,
                successMessage = "${product.name} (Precio $tier) agregado al carrito"
            )
        }
    }

    fun updateCartQuantity(productId: String, tier: Int, newQuantity: Double) {
        if (newQuantity <= 0) {
            removeFromCart(productId, tier)
            return
        }
        val currentCart = _uiState.value.cartItems.toMutableList()
        val index = currentCart.indexOfFirst { it.product.id == productId && it.selectedPriceTier == tier }
        if (index >= 0) {
            currentCart[index] = currentCart[index].copy(quantity = newQuantity)
            _uiState.update { it.copy(cartItems = currentCart) }
        }
    }

    fun updateCartItemTier(productId: String, oldTier: Int, newTier: Int) {
        if (newTier !in 1..3) return
        val currentCart = _uiState.value.cartItems.toMutableList()
        val index = currentCart.indexOfFirst { it.product.id == productId && it.selectedPriceTier == oldTier }
        if (index >= 0) {
            val oldItem = currentCart[index]
            val newPrice = oldItem.product.getPriceForTier(newTier)
            currentCart[index] = oldItem.copy(
                selectedPriceTier = newTier,
                customPrice = newPrice
            )
            _uiState.update { it.copy(cartItems = currentCart) }
        }
    }

    fun removeFromCart(productId: String, tier: Int) {
        val currentCart = _uiState.value.cartItems.filterNot { it.product.id == productId && it.selectedPriceTier == tier }
        _uiState.update { it.copy(cartItems = currentCart) }
    }

    fun clearCart() {
        _uiState.update { it.copy(cartItems = emptyList()) }
    }

    fun calculateTotal(): Double {
        return _uiState.value.cartItems.sumOf { it.getSubtotal() }
    }

    fun dismissMessages() {
        _uiState.update { it.copy(errorMessage = null, successMessage = null) }
    }
}
