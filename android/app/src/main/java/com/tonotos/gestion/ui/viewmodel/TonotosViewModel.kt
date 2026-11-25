package com.tonotos.gestion.ui.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.tonotos.gestion.data.model.*
import com.tonotos.gestion.data.repository.TonotosRepository
import com.tonotos.gestion.ui.screens.ScannedBatchItem
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class UiState(
    val serverUrl: String = "192.168.1.100:3000",
    val isServerConnected: Boolean = false,
    val isLoggedIn: Boolean = false,
    val currentUser: User? = null,
    val isLoading: Boolean = false,
    val isTestingConnection: Boolean = false,
    val connectionSuccessMsg: String? = null,
    val errorMessage: String? = null,
    val successMessage: String? = null,

    // Catalog
    val products: List<Product> = emptyList(),
    val filteredProducts: List<Product> = emptyList(),
    val categories: List<String> = emptyList(),
    val selectedCategory: String? = null,
    val searchQuery: String = "",
    val showProductDialog: Boolean = false,
    val editingProduct: Product? = null,

    // Customers
    val customers: List<Customer> = emptyList(),
    val selectedCustomer: Customer? = null,
    val showCustomerDialog: Boolean = false,
    val editingCustomer: Customer? = null,

    // Cash Register
    val cashRegisterSession: CashRegisterSession? = null,
    val showCashRegisterDialog: Boolean = false,

    // Sales Orders
    val salesOrders: List<SalesOrder> = emptyList(),

    // Dashboard
    val dashboardData: DashboardResponse? = null,

    // Sale / Cart
    val cartItems: List<CartItem> = emptyList(),
    val customerName: String = "Consumidor final",
    val paymentMethod: String = "cash",
    val generalDiscountPercent: String = "0",
    val isSubmittingSale: Boolean = false,
    val pendingSyncCount: Int = 0,
    val lastCompletedTransaction: Transaction? = null,
    val showReceiptDialog: Boolean = false,
    val showBarcodeScanner: Boolean = false,

    // History
    val recentTransactions: List<Transaction> = emptyList()
)

class TonotosViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = TonotosRepository(application)
    private var syncMonitorJob: Job? = null

    private val _uiState = MutableStateFlow(UiState())
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()

    init {
        val savedServerUrl = repository.getSavedServerUrl()
        val savedUser = repository.getSavedUser()
        val savedToken = repository.getSavedToken()

        _uiState.update {
            it.copy(
                serverUrl = savedServerUrl,
                currentUser = savedUser,
                isLoggedIn = savedUser != null && savedToken != null
            )
        }

        testAndSaveServerUrl(savedServerUrl)
    }

    fun updateServerUrlInput(url: String) {
        _uiState.update { it.copy(serverUrl = url, connectionSuccessMsg = null, errorMessage = null) }
    }

    fun testAndSaveServerUrl(urlInput: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isTestingConnection = true, errorMessage = null, connectionSuccessMsg = null) }
            val result = repository.testConnection(urlInput)
            result.onSuccess { session ->
                _uiState.update {
                    it.copy(
                        isTestingConnection = false,
                        isServerConnected = true,
                        serverUrl = urlInput,
                        connectionSuccessMsg = "¡Conexión exitosa con la PC!",
                        isLoggedIn = session.user != null,
                        currentUser = session.user
                    )
                }
                if (session.user != null) {
                    loadInitialData()
                }
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        isTestingConnection = false,
                        isServerConnected = false,
                        errorMessage = err.message ?: "No se pudo conectar al servidor"
                    )
                }
            }
        }
    }

    fun login(emailInput: String, passwordInput: String) {
        if (emailInput.isBlank() || passwordInput.isBlank()) {
            _uiState.update { it.copy(errorMessage = "Ingresá tu usuario y contraseña") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            val result = repository.login(emailInput.trim(), passwordInput)
            result.onSuccess { res ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        isLoggedIn = true,
                        currentUser = res.user,
                        errorMessage = null,
                        successMessage = "¡Bienvenido/a ${res.user.displayName}!"
                    )
                }
                loadInitialData()
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = err.message ?: "Correo o contraseña no válidos"
                    )
                }
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            syncMonitorJob?.cancel()
            syncMonitorJob = null
            repository.setAuthToken(null)
            _uiState.update {
                it.copy(
                    isLoggedIn = false,
                    currentUser = null,
                    cartItems = emptyList(),
                    products = emptyList(),
                    filteredProducts = emptyList(),
                    customers = emptyList(),
                    salesOrders = emptyList()
                )
            }
        }
    }

    private fun loadInitialData() {
        loadProducts()
        loadCustomers()
        loadRecentTransactions()
        loadCashRegister()
        loadSalesOrders()
        loadDashboard()
        startSyncMonitor()
    }

    // Product Management
    fun loadProducts() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val result = repository.getProducts()
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
                        pendingSyncCount = repository.getPendingSalesCount(),
                        isServerConnected = true
                    )
                }

                applyProductFilter()
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = err.message ?: "Error al actualizar catálogo de productos"
                    )
                }
            }
        }
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

    fun saveProduct(request: ProductRequest, editingId: Int? = null) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val result = if (editingId != null) {
                repository.updateProduct(editingId, request)
            } else {
                repository.createProduct(request)
            }
            result.onSuccess {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        showProductDialog = false,
                        editingProduct = null,
                        successMessage = if (editingId != null) "Producto actualizado con éxito" else "Producto creado con éxito"
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

    fun deleteProduct(id: Int) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val result = repository.deleteProduct(id)
            result.onSuccess {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        successMessage = "Producto archivado correctamente"
                    )
                }
                loadProducts()
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = err.message ?: "No se pudo archivar el producto"
                    )
                }
            }
        }
    }

    // Customer Management
    fun loadCustomers() {
        viewModelScope.launch {
            val result = repository.getCustomers()
            result.onSuccess { list ->
                _uiState.update { it.copy(customers = list) }
            }
        }
    }

    fun selectCustomer(customer: Customer?) {
        _uiState.update {
            it.copy(
                selectedCustomer = customer,
                customerName = customer?.name ?: "Consumidor final"
            )
        }
    }

    fun openCreateCustomerDialog() {
        _uiState.update { it.copy(editingCustomer = null, showCustomerDialog = true) }
    }

    fun openEditCustomerDialog(customer: Customer) {
        _uiState.update { it.copy(editingCustomer = customer, showCustomerDialog = true) }
    }

    fun closeCustomerDialog() {
        _uiState.update { it.copy(showCustomerDialog = false, editingCustomer = null) }
    }

    fun saveCustomer(request: CustomerRequest, editingId: Int? = null) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val result = if (editingId != null) {
                repository.updateCustomer(editingId, request)
            } else {
                repository.createCustomer(request)
            }
            result.onSuccess { customer ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        showCustomerDialog = false,
                        editingCustomer = null,
                        selectedCustomer = customer,
                        customerName = customer.name,
                        successMessage = if (editingId != null) "Cliente actualizado con éxito" else "Cliente creado con éxito"
                    )
                }
                loadCustomers()
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = err.message ?: "No se pudo guardar el cliente"
                    )
                }
            }
        }
    }

    fun deleteCustomer(id: Int) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val result = repository.deleteCustomer(id)
            result.onSuccess {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        selectedCustomer = null,
                        customerName = "Consumidor final",
                        successMessage = "Cliente archivado correctamente"
                    )
                }
                loadCustomers()
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = err.message ?: "No se pudo archivar el cliente"
                    )
                }
            }
        }
    }

    // Cash Register
    fun loadCashRegister() {
        viewModelScope.launch {
            val result = repository.getCashRegister()
            result.onSuccess { session ->
                _uiState.update { it.copy(cashRegisterSession = session) }
            }
        }
    }

    fun openCashRegisterDialog() {
        _uiState.update { it.copy(showCashRegisterDialog = true) }
    }

    fun closeCashRegisterDialog() {
        _uiState.update { it.copy(showCashRegisterDialog = false) }
    }

    fun openCashRegister(amount: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val result = repository.openCashRegister(amount)
            result.onSuccess {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        showCashRegisterDialog = false,
                        successMessage = "Caja abierta con éxito"
                    )
                }
                loadCashRegister()
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = err.message ?: "No se pudo abrir la caja"
                    )
                }
            }
        }
    }

    fun closeCashRegister(amount: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val result = repository.closeCashRegister(amount)
            result.onSuccess {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        showCashRegisterDialog = false,
                        successMessage = "Caja cerrada con éxito"
                    )
                }
                loadCashRegister()
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = err.message ?: "No se pudo cerrar la caja"
                    )
                }
            }
        }
    }

    // Sales Orders
    fun loadSalesOrders() {
        viewModelScope.launch {
            val result = repository.getSalesOrders()
            result.onSuccess { orders ->
                _uiState.update { it.copy(salesOrders = orders) }
            }
        }
    }

    fun submitSalesOrder() {
        val cart = _uiState.value.cartItems
        if (cart.isEmpty()) {
            _uiState.update { it.copy(errorMessage = "Agregá al menos un producto al pedido") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingSale = true, errorMessage = null) }

            val items = cart.map { item ->
                SaleItemRequest(
                    productId = item.product.id,
                    sku = item.product.sku,
                    name = item.product.name,
                    quantity = if (item.quantity % 1.0 == 0.0) item.quantity.toLong().toString() else item.quantity.toString(),
                    price = item.customPrice.toString(),
                    discountPercent = item.discountPercent.toString()
                )
            }

            val saleRequest = SaleRequest(
                customerId = _uiState.value.selectedCustomer?.id,
                contact = _uiState.value.customerName.ifBlank { "Consumidor final" },
                items = items,
                payments = emptyList(),
                generalDiscountPercent = _uiState.value.generalDiscountPercent
            )

            val result = repository.createSalesOrder(saleRequest)
            result.onSuccess { order ->
                _uiState.update {
                    it.copy(
                        isSubmittingSale = false,
                        cartItems = emptyList(),
                        customerName = "Consumidor final",
                        selectedCustomer = null,
                        generalDiscountPercent = "0",
                        successMessage = "¡Pedido #${order.number} guardado con éxito!"
                    )
                }
                loadSalesOrders()
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        isSubmittingSale = false,
                        errorMessage = err.message ?: "No se pudo guardar el pedido"
                    )
                }
            }
        }
    }

    fun convertSalesOrder(orderId: Int) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val totalAmount = _uiState.value.salesOrders.find { it.id == orderId }?.total ?: 0.0
            val payments = listOf(
                SalePaymentRequest(
                    method = _uiState.value.paymentMethod,
                    amount = totalAmount.toString()
                )
            )
            val result = repository.convertSalesOrder(orderId, payments)
            result.onSuccess { transaction ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        lastCompletedTransaction = transaction,
                        showReceiptDialog = true,
                        successMessage = "¡Pedido #${transaction.id} facturado y convertido en venta!"
                    )
                }
                loadSalesOrders()
                loadProducts()
                loadRecentTransactions()
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = err.message ?: "No se pudo facturar el pedido"
                    )
                }
            }
        }
    }

    fun cancelSalesOrder(orderId: Int) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val result = repository.cancelSalesOrder(orderId)
            result.onSuccess {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        successMessage = "Pedido cancelado"
                    )
                }
                loadSalesOrders()
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = err.message ?: "No se pudo cancelar el pedido"
                    )
                }
            }
        }
    }

    // Barcode Scanning
    fun openBarcodeScanner() {
        _uiState.update { it.copy(showBarcodeScanner = true) }
    }

    fun closeBarcodeScanner() {
        _uiState.update { it.copy(showBarcodeScanner = false) }
    }

    fun sendLiveScan(barcode: String) {
        if (barcode.isBlank()) return
        viewModelScope.launch {
            val result = repository.sendLiveScan(barcode.trim())
            result.onSuccess {
                _uiState.update { it.copy(successMessage = "Código $barcode enviado a la PC") }
            }.onFailure { err ->
                _uiState.update { it.copy(errorMessage = "Error al enviar código a la PC: ${err.message}") }
            }
        }
    }

    fun scanAndAddToCart(scannedCode: String) {
        val code = scannedCode.trim()
        val product = _uiState.value.products.find {
            it.barcode.equals(code, ignoreCase = true) || it.sku.equals(code, ignoreCase = true)
        }
        if (product != null) {
            addToCart(product, 1.0)
            _uiState.update { it.copy(successMessage = "Producto escaneado: ${product.name}") }
        } else {
            _uiState.update { it.copy(errorMessage = "No se encontró ningún producto con el código: $code") }
        }
    }

    fun submitBatchAsOrder(batch: List<ScannedBatchItem>) {
        if (batch.isEmpty()) return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val items = batch.map {
                SaleItemRequest(
                    productId = it.product.id,
                    sku = it.product.sku,
                    name = it.product.name,
                    quantity = if (it.quantity % 1.0 == 0.0) it.quantity.toLong().toString() else it.quantity.toString(),
                    price = it.product.price
                )
            }
            val request = SaleRequest(
                contact = _uiState.value.customerName.ifBlank { "Consumidor final" },
                items = items,
                payments = emptyList()
            )
            val result = repository.createSalesOrder(request)
            result.onSuccess { order ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        successMessage = "¡Lote escaneado enviado como Pedido #${order.number} a la PC!"
                    )
                }
                loadSalesOrders()
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = err.message ?: "No se pudo enviar el lote escaneado"
                    )
                }
            }
        }
    }

    fun submitBatchAsSale(batch: List<ScannedBatchItem>) {
        if (batch.isEmpty()) return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val items = batch.map {
                SaleItemRequest(
                    productId = it.product.id,
                    sku = it.product.sku,
                    name = it.product.name,
                    quantity = if (it.quantity % 1.0 == 0.0) it.quantity.toLong().toString() else it.quantity.toString(),
                    price = it.product.price
                )
            }
            val total = batch.sumOf { (it.product.price.toDoubleOrNull() ?: 0.0) * it.quantity }
            val payments = listOf(
                SalePaymentRequest(
                    method = _uiState.value.paymentMethod,
                    amount = total.toString()
                )
            )
            val request = SaleRequest(
                contact = _uiState.value.customerName.ifBlank { "Consumidor final" },
                items = items,
                payments = payments
            )
            val result = repository.createSale(request)
            result.onSuccess { transaction ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        lastCompletedTransaction = transaction,
                        showReceiptDialog = true,
                        successMessage = "¡Lote escaneado registrado como Venta #${transaction.id}!"
                    )
                }
                loadProducts()
                loadRecentTransactions()
                loadDashboard()
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = err.message ?: "No se pudo registrar la venta del lote escaneado"
                    )
                }
            }
        }
    }

    // Dashboard
    fun loadDashboard() {
        viewModelScope.launch {
            val result = repository.getDashboard()
            result.onSuccess { data ->
                _uiState.update { it.copy(dashboardData = data) }
            }
        }
    }

    private fun startSyncMonitor() {
        syncMonitorJob?.cancel()
        syncMonitorJob = viewModelScope.launch {
            while (isActive && _uiState.value.isLoggedIn) {
                delay(15_000)
                if (repository.getPendingSalesCount() == 0) break
                val result = repository.getProducts()
                result.onSuccess { products ->
                    _uiState.update {
                        it.copy(
                            products = products,
                            pendingSyncCount = repository.getPendingSalesCount(),
                            errorMessage = repository.lastSyncError
                        )
                    }
                    applyProductFilter()
                }.onFailure { error ->
                    _uiState.update { it.copy(errorMessage = error.message) }
                }
            }
            syncMonitorJob = null
        }
    }

    fun setSearchQuery(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
        applyProductFilter()
    }

    fun setSelectedCategory(category: String?) {
        val newCategory = if (_uiState.value.selectedCategory == category) null else category
        _uiState.update { it.copy(selectedCategory = newCategory) }
        applyProductFilter()
    }

    private fun applyProductFilter() {
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
    fun addToCart(product: Product, quantityToAdd: Double = 1.0) {
        val currentCart = _uiState.value.cartItems.toMutableList()
        val index = currentCart.indexOfFirst { it.product.id == product.id }
        if (index >= 0) {
            val item = currentCart[index]
            currentCart[index] = item.copy(quantity = item.quantity + quantityToAdd)
        } else {
            currentCart.add(CartItem(product = product, quantity = quantityToAdd))
        }
        _uiState.update { it.copy(cartItems = currentCart, successMessage = "${product.name} agregado a la venta") }
    }

    fun updateCartQuantity(productId: Int, newQuantity: Double) {
        if (newQuantity <= 0) {
            removeFromCart(productId)
            return
        }
        val currentCart = _uiState.value.cartItems.toMutableList()
        val index = currentCart.indexOfFirst { it.product.id == productId }
        if (index >= 0) {
            currentCart[index] = currentCart[index].copy(quantity = newQuantity)
            _uiState.update { it.copy(cartItems = currentCart) }
        }
    }

    fun removeFromCart(productId: Int) {
        val currentCart = _uiState.value.cartItems.filterNot { it.product.id == productId }
        _uiState.update { it.copy(cartItems = currentCart) }
    }

    fun clearCart() {
        _uiState.update { it.copy(cartItems = emptyList(), customerName = "Consumidor final", selectedCustomer = null, generalDiscountPercent = "0") }
    }

    fun setCustomerName(name: String) {
        _uiState.update { it.copy(customerName = name) }
    }

    fun setPaymentMethod(method: String) {
        _uiState.update { it.copy(paymentMethod = method) }
    }

    fun setGeneralDiscount(discountStr: String) {
        _uiState.update { it.copy(generalDiscountPercent = discountStr) }
    }

    fun calculateSubtotal(): Double {
        return _uiState.value.cartItems.sumOf { it.getSubtotal() }
    }

    fun calculateTotal(): Double {
        val subtotal = calculateSubtotal()
        val discount = _uiState.value.generalDiscountPercent.toDoubleOrNull() ?: 0.0
        return (subtotal * (1.0 - (discount / 100.0))).coerceAtLeast(0.0)
    }

    fun submitSale() {
        val cart = _uiState.value.cartItems
        if (cart.isEmpty()) {
            _uiState.update { it.copy(errorMessage = "Agregá al menos un producto a la venta") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingSale = true, errorMessage = null) }

            val items = cart.map { item ->
                SaleItemRequest(
                    productId = item.product.id,
                    sku = item.product.sku,
                    name = item.product.name,
                    quantity = if (item.quantity % 1.0 == 0.0) item.quantity.toLong().toString() else item.quantity.toString(),
                    price = item.customPrice.toString(),
                    discountPercent = item.discountPercent.toString()
                )
            }

            val totalAmount = calculateTotal()
            val payments = listOf(
                SalePaymentRequest(
                    method = _uiState.value.paymentMethod,
                    amount = totalAmount.toString()
                )
            )

            val saleRequest = SaleRequest(
                customerId = _uiState.value.selectedCustomer?.id,
                contact = _uiState.value.customerName.ifBlank { "Consumidor final" },
                items = items,
                payments = payments,
                generalDiscountPercent = _uiState.value.generalDiscountPercent
            )

            val result = repository.createSale(saleRequest)
            result.onSuccess { transaction ->
                val pending = transaction.pendingSync
                val pendingCount = repository.getPendingSalesCount()
                _uiState.update {
                    it.copy(
                        isSubmittingSale = false,
                        cartItems = emptyList(),
                        customerName = "Consumidor final",
                        selectedCustomer = null,
                        generalDiscountPercent = "0",
                        pendingSyncCount = pendingCount,
                        lastCompletedTransaction = if (pending) null else transaction,
                        showReceiptDialog = !pending,
                        successMessage = if (pending) {
                            "Venta guardada en este dispositivo; se sincronizará al volver a estar online. Pendientes: $pendingCount."
                        } else {
                            "¡Venta #${transaction.id} registrada y sincronizada con la PC!"
                        }
                    )
                }
                if (pending) startSyncMonitor()
                loadProducts()
                loadRecentTransactions()
                loadCashRegister()
                loadDashboard()
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        isSubmittingSale = false,
                        errorMessage = err.message ?: "No se pudo registrar la venta en la PC"
                    )
                }
            }
        }
    }

    fun dismissReceiptDialog() {
        _uiState.update { it.copy(showReceiptDialog = false, lastCompletedTransaction = null) }
    }

    fun loadRecentTransactions() {
        viewModelScope.launch {
            val result = repository.getRecentTransactions()
            result.onSuccess { list ->
                _uiState.update { it.copy(recentTransactions = list) }
            }
        }
    }

    fun dismissMessages() {
        _uiState.update { it.copy(errorMessage = null, successMessage = null) }
    }
}
