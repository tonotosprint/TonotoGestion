package com.tonotos.consultaprecios.ui.screens

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
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
import com.tonotos.consultaprecios.data.model.Product
import com.tonotos.consultaprecios.ui.theme.*
import com.tonotos.consultaprecios.ui.viewmodel.UiState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    state: UiState,
    onSearchQueryChange: (String) -> Unit,
    onSelectCategory: (String?) -> Unit,
    onSelectPriceTier: (Int) -> Unit,
    onAddToCart: (Product, Double, Int) -> Unit,
    onAddProduct: () -> Unit,
    onEditProduct: (Product) -> Unit,
    onRefresh: () -> Unit,
    onOpenConfig: () -> Unit,
    onGoToCart: () -> Unit
) {
    val totalCartItems = state.cartItems.sumOf { it.quantity }.toInt()

    Scaffold(
        topBar = {
            Column {
                // Header Bar
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(NavyPrimary)
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Default.Cloud,
                            contentDescription = "Firebase",
                            tint = OrangeFirebase,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = if (state.firebaseProjectId.isNotBlank())
                                "Firebase: ${state.firebaseProjectId}"
                            else
                                "Firebase Cloud (Configurar)",
                            fontSize = 12.sp,
                            color = SurfaceWhite,
                            fontWeight = FontWeight.SemiBold
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
                        Spacer(modifier = Modifier.width(6.dp))
                        IconButton(
                            onClick = onOpenConfig,
                            modifier = Modifier.size(28.dp)
                        ) {
                            Icon(
                                Icons.Default.Settings,
                                contentDescription = "Configuración",
                                tint = SurfaceWhite,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                }

                // Header Search & Price Tier Selector Bar
                Surface(
                    color = SurfaceWhite,
                    shadowElevation = 2.dp
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        // Selector de los 3 Precios
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(bottom = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Text(
                                text = "Lista:",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = TextMuted,
                                modifier = Modifier.padding(end = 2.dp)
                            )

                            val tiers = listOf(
                                1 to "Precio 1 (Contado)",
                                2 to "Precio 2 (Tarjeta)",
                                3 to "Precio 3 (Mayorista)"
                            )

                            tiers.forEach { (tier, label) ->
                                val isSelected = state.selectedPriceTier == tier
                                FilterChip(
                                    selected = isSelected,
                                    onClick = { onSelectPriceTier(tier) },
                                    label = { Text(label, fontSize = 11.sp, fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal) },
                                    colors = FilterChipDefaults.filterChipColors(
                                        selectedContainerColor = AccentBlue,
                                        selectedLabelColor = Color.White
                                    ),
                                    modifier = Modifier.weight(1f)
                                )
                            }
                        }

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
                                    if (state.searchQuery.isNotBlank()) {
                                        IconButton(
                                            onClick = { onSearchQueryChange("") },
                                            modifier = Modifier.size(32.dp)
                                        ) {
                                            Icon(
                                                Icons.Default.Close,
                                                contentDescription = "Borrar",
                                                tint = TextMuted,
                                                modifier = Modifier.size(18.dp)
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

                            Button(
                                onClick = onAddProduct,
                                shape = RoundedCornerShape(10.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = AccentBlue),
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp)
                            ) {
                                Icon(Icons.Default.Add, contentDescription = "Nuevo Producto", modifier = Modifier.size(18.dp))
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
                    text = { Text("Ver Carrito (${state.cartItems.size})", fontWeight = FontWeight.Bold) }
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
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Text(
                        text = if (state.searchQuery.isNotBlank() || state.selectedCategory != null)
                            "No se encontraron productos con ese filtro"
                        else
                            "No hay productos cargados en Firebase",
                        color = TextMuted,
                        fontSize = 14.sp
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Button(
                        onClick = onOpenConfig,
                        colors = ButtonDefaults.buttonColors(containerColor = AccentBlue)
                    ) {
                        Text("Configurar Proyecto Firebase")
                    }
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
                            selectedPriceTier = state.selectedPriceTier,
                            quantityInCart = cartQty,
                            onAddToCart = { qty, tier -> onAddToCart(product, qty, tier) },
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
    selectedPriceTier: Int = 1,
    quantityInCart: Int = 0,
    onAddToCart: (Double, Int) -> Unit,
    onEdit: () -> Unit = {}
) {
    val stock = product.getNumericStock()
    val isOutOfStock = stock <= 0
    var quantityText by remember { mutableStateOf("1") }
    var activeCardTier by remember(selectedPriceTier) { mutableIntStateOf(selectedPriceTier) }

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

                        if (!product.category.isNullOrBlank()) {
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

                IconButton(onClick = onEdit, modifier = Modifier.size(28.dp)) {
                    Icon(Icons.Default.Edit, contentDescription = "Editar", tint = TextMuted, modifier = Modifier.size(16.dp))
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Fila con los 3 Precios visibles
            Surface(
                color = BackgroundLight,
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.SpaceAround,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    PriceChip(
                        label = "P1 (Contado)",
                        formattedPrice = product.getFormattedPriceForTier(1),
                        isSelected = activeCardTier == 1,
                        onClick = { activeCardTier = 1 }
                    )
                    PriceChip(
                        label = "P2 (Tarjeta)",
                        formattedPrice = product.getFormattedPriceForTier(2),
                        isSelected = activeCardTier == 2,
                        onClick = { activeCardTier = 2 }
                    )
                    PriceChip(
                        label = "P3 (Mayorista)",
                        formattedPrice = product.getFormattedPriceForTier(3),
                        isSelected = activeCardTier == 3,
                        onClick = { activeCardTier = 3 }
                    )
                }
            }

            Spacer(modifier = Modifier.height(10.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = product.getFormattedPriceForTier(activeCardTier),
                        fontSize = 18.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = NavyPrimary
                    )

                    Spacer(modifier = Modifier.width(8.dp))

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

                // Cantidad manual + Botón Agregar
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    OutlinedTextField(
                        value = quantityText,
                        onValueChange = { quantityText = it },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.width(58.dp),
                        shape = RoundedCornerShape(8.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = AccentBlue,
                            unfocusedBorderColor = LineBorder
                        )
                    )

                    Button(
                        onClick = {
                            val qty = quantityText.toDoubleOrNull() ?: 1.0
                            if (qty > 0) onAddToCart(qty, activeCardTier)
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

@Composable
fun PriceChip(
    label: String,
    formattedPrice: String,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(if (isSelected) AccentBlue else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 6.dp, vertical = 4.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = label,
                fontSize = 9.sp,
                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                color = if (isSelected) Color.White else TextMuted
            )
            Text(
                text = formattedPrice,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = if (isSelected) Color.White else TextDark
            )
        }
    }
}
