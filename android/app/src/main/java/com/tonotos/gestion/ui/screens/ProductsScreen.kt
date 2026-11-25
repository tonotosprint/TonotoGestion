package com.tonotos.gestion.ui.screens

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tonotos.gestion.data.model.Product
import com.tonotos.gestion.ui.theme.*
import com.tonotos.gestion.ui.viewmodel.UiState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductsScreen(
    state: UiState,
    onSearchQueryChange: (String) -> Unit,
    onSelectCategory: (String?) -> Unit,
    onAddToCart: (Product, Double) -> Unit,
    onAddProduct: () -> Unit,
    onEditProduct: (Product) -> Unit,
    onRefresh: () -> Unit,
    onGoToCart: () -> Unit,
    onOpenHamburgerMenu: () -> Unit,
    onOpenScanner: () -> Unit = {}
) {
    val totalCartItems = state.cartItems.sumOf { it.quantity }.toInt()

    Scaffold(
        topBar = {
            Column {
                // Server Sync Header Bar
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(NavyPrimary)
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(10.dp)
                                .clip(CircleShape)
                                .background(StockGreen)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "PC: ${state.serverUrl}",
                            fontSize = 12.sp,
                            color = SurfaceWhite,
                            fontWeight = FontWeight.Medium
                        )
                    }

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(
                            onClick = onRefresh,
                            modifier = Modifier.size(28.dp)
                        ) {
                            Icon(
                                Icons.Default.Refresh,
                                contentDescription = "Actualizar",
                                tint = SurfaceWhite,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        IconButton(
                            onClick = onOpenHamburgerMenu,
                            modifier = Modifier.size(28.dp)
                        ) {
                            Icon(
                                Icons.Default.Menu,
                                contentDescription = "Menú",
                                tint = SurfaceWhite,
                                modifier = Modifier.size(22.dp)
                            )
                        }
                    }
                }

                // Search Bar & Action Header
                Surface(
                    color = SurfaceWhite,
                    shadowElevation = 2.dp
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            OutlinedTextField(
                                value = state.searchQuery,
                                onValueChange = onSearchQueryChange,
                                placeholder = { Text("Buscar producto, SKU...") },
                                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, tint = TextMuted) },
                                trailingIcon = {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(2.dp)
                                    ) {
                                        if (state.searchQuery.isNotBlank()) {
                                            IconButton(
                                                onClick = { onSearchQueryChange("") },
                                                modifier = Modifier.size(32.dp)
                                            ) {
                                                Icon(
                                                    Icons.Default.Close,
                                                    contentDescription = "Borrar búsqueda",
                                                    tint = TextMuted,
                                                    modifier = Modifier.size(18.dp)
                                                )
                                            }
                                        }
                                        IconButton(
                                            onClick = onOpenScanner,
                                            modifier = Modifier.size(32.dp)
                                        ) {
                                            Icon(
                                                Icons.Default.QrCodeScanner,
                                                contentDescription = "Escanear",
                                                tint = AccentBlue,
                                                modifier = Modifier.size(20.dp)
                                            )
                                        }
                                    }
                                },
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(10.dp),
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = AccentBlue,
                                    unfocusedBorderColor = LineBorder,
                                    focusedContainerColor = BackgroundLight,
                                    unfocusedContainerColor = BackgroundLight
                                )
                            )

                            if (state.currentUser?.role != "seller") {
                                Button(
                                    onClick = onAddProduct,
                                    shape = RoundedCornerShape(10.dp),
                                    colors = ButtonDefaults.buttonColors(containerColor = AccentBlue),
                                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp)
                                ) {
                                    Icon(Icons.Default.Add, contentDescription = "Nuevo Producto", modifier = Modifier.size(18.dp))
                                }
                            }
                        }

                        // Category Chips
                        if (state.categories.isNotEmpty()) {
                            Spacer(modifier = Modifier.height(8.dp))
                            LazyRow(
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                item {
                                    FilterChip(
                                        selected = state.selectedCategory == null,
                                        onClick = { onSelectCategory(null) },
                                        label = { Text("Todos (${state.products.size})") },
                                        colors = FilterChipDefaults.filterChipColors(
                                            selectedContainerColor = AccentBlue,
                                            selectedLabelColor = Color.White
                                        )
                                    )
                                }
                                items(state.categories) { cat ->
                                    FilterChip(
                                        selected = state.selectedCategory == cat,
                                        onClick = { onSelectCategory(cat) },
                                        label = { Text(cat) },
                                        colors = FilterChipDefaults.filterChipColors(
                                            selectedContainerColor = AccentBlue,
                                            selectedLabelColor = Color.White
                                        )
                                    )
                                }
                            }
                        }
                    }
                }
            }
        },
        floatingActionButton = {
            if (totalCartItems > 0) {
                ExtendedFloatingActionButton(
                    onClick = onGoToCart,
                    containerColor = AccentBlue,
                    contentColor = Color.White,
                    icon = {
                        BadgedBox(
                            badge = {
                                Badge(containerColor = AlertRed, contentColor = Color.White) {
                                    Text(totalCartItems.toString())
                                }
                            }
                        ) {
                            Icon(Icons.Default.ShoppingCart, contentDescription = "Carrito")
                        }
                    },
                    text = { Text("Ver Venta (${state.cartItems.size})", fontWeight = FontWeight.Bold) }
                )
            }
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .background(BackgroundLight)
        ) {
            if (state.isLoading && state.products.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = AccentBlue)
                }
            } else if (state.filteredProducts.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(32.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = if (state.searchQuery.isNotBlank() || state.selectedCategory != null)
                            "No se encontraron productos con ese filtro"
                        else
                            "No hay productos cargados en el sistema",
                        color = TextMuted,
                        fontSize = 14.sp
                    )
                }
            } else {
                val configuration = LocalConfiguration.current
                val isLandscape = configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
                val isWideScreen = configuration.screenWidthDp >= 500
                val columns = if (isLandscape || isWideScreen) 2 else 1

                LazyVerticalGrid(
                    columns = GridCells.Fixed(columns),
                    contentPadding = PaddingValues(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.fillMaxSize()
                ) {
                    items(state.filteredProducts, key = { it.id }) { product ->
                        val cartItem = state.cartItems.find { it.product.id == product.id }
                        val cartQty = cartItem?.quantity?.toInt() ?: 0

                        ProductCard(
                            product = product,
                            quantityInCart = cartQty,
                            canEdit = state.currentUser?.role != "seller",
                            onAddToCart = { qty -> onAddToCart(product, qty) },
                            onEdit = { onEditProduct(product) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun ProductCard(
    product: Product,
    quantityInCart: Int,
    canEdit: Boolean = false,
    onAddToCart: (Double) -> Unit,
    onEdit: () -> Unit = {}
) {
    val stock = product.getNumericStock()
    val isOutOfStock = stock <= 0
    var quantityText by remember { mutableStateOf("1") }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp)),
        colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (product.sku.isNotBlank()) {
                            Surface(
                                color = BackgroundLight,
                                shape = RoundedCornerShape(4.dp)
                            ) {
                                Text(
                                    text = product.sku,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = TextMuted,
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                )
                            }
                            Spacer(modifier = Modifier.width(6.dp))
                        }

                        if (!product.category.isNull_or_Blank()) {
                            Surface(
                                color = AccentSoft,
                                shape = RoundedCornerShape(4.dp)
                            ) {
                                Text(
                                    text = product.category ?: "",
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = AccentBlue,
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(4.dp))

                    Text(
                        text = product.name,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextDark,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                if (canEdit) {
                    IconButton(onClick = onEdit, modifier = Modifier.size(28.dp)) {
                        Icon(Icons.Default.Edit, contentDescription = "Editar", tint = TextMuted, modifier = Modifier.size(16.dp))
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = product.getFormattedPrice(),
                        fontSize = 17.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = NavyPrimary
                    )

                    Spacer(modifier = Modifier.width(10.dp))

                    Surface(
                        color = if (isOutOfStock) Color(0xFFFDE8E8) else Color(0xFFE8F5E9),
                        shape = RoundedCornerShape(6.dp)
                    ) {
                        Text(
                            text = if (isOutOfStock) "Sin Stock" else "Stock: ${if (stock % 1.0 == 0.0) stock.toInt() else stock}",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (isOutOfStock) AlertRed else StockGreen,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                    }
                }

                // Cantidad manual + Botón Vender
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    OutlinedTextField(
                        value = quantityText,
                        onValueChange = { quantityText = it },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.width(62.dp),
                        shape = RoundedCornerShape(8.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = AccentBlue,
                            unfocusedBorderColor = LineBorder
                        )
                    )

                    Button(
                        onClick = {
                            val qty = quantityText.toDoubleOrNull() ?: 1.0
                            if (qty > 0) onAddToCart(qty)
                        },
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (quantityInCart > 0) StockGreen else AccentBlue
                        ),
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 8.dp)
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (quantityInCart > 0) {
                                Icon(Icons.Default.CheckCircle, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("$quantityInCart", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                            } else {
                                Icon(Icons.Default.Add, contentDescription = "Agregar", tint = Color.White, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(2.dp))
                                Text("Agregar", fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun String?.isNull_or_Blank(): Boolean = this == null || this.trim().isEmpty()
