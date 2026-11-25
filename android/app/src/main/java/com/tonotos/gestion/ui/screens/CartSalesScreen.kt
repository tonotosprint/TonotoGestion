package com.tonotos.gestion.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tonotos.gestion.data.model.CartItem
import com.tonotos.gestion.data.model.Customer
import com.tonotos.gestion.ui.theme.*
import com.tonotos.gestion.ui.viewmodel.UiState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CartSalesScreen(
    state: UiState,
    onCustomerNameChange: (String) -> Unit,
    onSelectCustomer: (Customer?) -> Unit,
    onPaymentMethodChange: (String) -> Unit,
    onDiscountChange: (String) -> Unit,
    onUpdateQuantity: (Int, Double) -> Unit,
    onRemoveItem: (Int) -> Unit,
    onClearCart: () -> Unit,
    onSubmitSale: () -> Unit,
    onSubmitOrder: () -> Unit,
    onGoToProducts: () -> Unit,
    onOpenHamburgerMenu: () -> Unit,
    onOpenScanner: () -> Unit = {}
) {
    val isSeller = state.currentUser?.role == "seller"
    val subtotal = state.cartItems.sumOf { it.getSubtotal() }
    val discountPercent = state.generalDiscountPercent.toDoubleOrNull() ?: 0.0
    val total = (subtotal * (1.0 - (discountPercent / 100.0))).coerceAtLeast(0.0)
    var isOrderMode by remember { mutableStateOf(isSeller) }

    LaunchedEffect(isSeller) {
        if (isSeller) isOrderMode = true
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = if (isOrderMode || isSeller) "Nuevo Pedido (${state.cartItems.size})" else "Nueva Venta (${state.cartItems.size})",
                        fontWeight = FontWeight.Bold,
                        color = NavyPrimary
                    )
                },
                actions = {
                    IconButton(onClick = onOpenScanner) {
                        Icon(Icons.Default.QrCodeScanner, contentDescription = "Escanear", tint = AccentBlue, modifier = Modifier.size(24.dp))
                    }
                    if (state.cartItems.isNotEmpty()) {
                        TextButton(onClick = onClearCart) {
                            Icon(Icons.Default.Delete, contentDescription = null, tint = AlertRed, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Vaciar", color = AlertRed, fontWeight = FontWeight.SemiBold)
                        }
                    }
                    IconButton(onClick = onOpenHamburgerMenu) {
                        Icon(Icons.Default.Menu, contentDescription = "Menú", tint = NavyPrimary, modifier = Modifier.size(28.dp))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SurfaceWhite)
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .background(BackgroundLight)
        ) {
            if (state.cartItems.isEmpty()) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.ShoppingCart,
                        contentDescription = null,
                        tint = TextMuted,
                        modifier = Modifier.size(64.dp)
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        text = "El carrito está vacío",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        color = NavyPrimary
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = "Seleccioná productos en el catálogo para armar el pedido de venta",
                        fontSize = 13.sp,
                        color = TextMuted
                    )
                    Spacer(modifier = Modifier.height(20.dp))
                    Button(
                        onClick = onGoToProducts,
                        colors = ButtonDefaults.buttonColors(containerColor = AccentBlue),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Text("Ir al Catálogo de Productos", fontWeight = FontWeight.Bold)
                    }
                }
            } else {
                Column(modifier = Modifier.fillMaxSize()) {
                    LazyColumn(
                        modifier = Modifier
                            .weight(1f)
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        // Operation Mode Switcher (solo si no es vendedor)
                        if (!isSeller) {
                            item {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    FilterChip(
                                        selected = !isOrderMode,
                                        onClick = { isOrderMode = false },
                                        label = { Text("Venta Directa") },
                                        leadingIcon = { Icon(Icons.Default.ShoppingCart, contentDescription = null) },
                                        colors = FilterChipDefaults.filterChipColors(
                                            selectedContainerColor = AccentBlue,
                                            selectedLabelColor = Color.White
                                        ),
                                        modifier = Modifier.weight(1f)
                                    )
                                    FilterChip(
                                        selected = isOrderMode,
                                        onClick = { isOrderMode = true },
                                        label = { Text("Pedido de Venta") },
                                        leadingIcon = { Icon(Icons.Default.List, contentDescription = null) },
                                        colors = FilterChipDefaults.filterChipColors(
                                            selectedContainerColor = AccentBlue,
                                            selectedLabelColor = Color.White
                                        ),
                                        modifier = Modifier.weight(1f)
                                    )
                                }
                            }
                        }

                        // Customer Details Card
                        item {
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Column(modifier = Modifier.padding(14.dp)) {
                                    Text(
                                        text = "Datos del Cliente",
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = TextMuted
                                    )
                                    Spacer(modifier = Modifier.height(8.dp))

                                    OutlinedTextField(
                                        value = state.customerName,
                                        onValueChange = onCustomerNameChange,
                                        label = { Text("Cliente / Contacto") },
                                        leadingIcon = { Icon(Icons.Default.Person, contentDescription = null, tint = TextMuted) },
                                        singleLine = true,
                                        modifier = Modifier.fillMaxWidth(),
                                        shape = RoundedCornerShape(8.dp),
                                        colors = OutlinedTextFieldDefaults.colors(
                                            focusedBorderColor = AccentBlue,
                                            unfocusedBorderColor = LineBorder
                                        )
                                    )

                                    if (!isOrderMode) {
                                        Spacer(modifier = Modifier.height(12.dp))

                                        Text(
                                            text = "Medio de Pago",
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            color = TextDark
                                        )
                                        Spacer(modifier = Modifier.height(6.dp))

                                        val methods = listOf(
                                            "cash" to "Efectivo",
                                            "debit" to "Tarjeta",
                                            "transfer" to "Transferencia",
                                            "other" to "Mercado Pago"
                                        )

                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                                        ) {
                                            methods.forEach { (key, label) ->
                                                val isSelected = state.paymentMethod == key
                                                FilterChip(
                                                    selected = isSelected,
                                                    onClick = { onPaymentMethodChange(key) },
                                                    label = { Text(label, fontSize = 11.sp) },
                                                    colors = FilterChipDefaults.filterChipColors(
                                                        selectedContainerColor = AccentBlue,
                                                        selectedLabelColor = Color.White
                                                    ),
                                                    modifier = Modifier.weight(1f)
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Items header
                        item {
                            Text(
                                text = "Productos en el Carrito",
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold,
                                color = NavyPrimary,
                                modifier = Modifier.padding(start = 4.dp, top = 4.dp)
                            )
                        }

                        items(state.cartItems, key = { it.product.id }) { cartItem ->
                            CartItemRow(
                                item = cartItem,
                                onUpdateQty = { newQty -> onUpdateQuantity(cartItem.product.id, newQty) },
                                onRemove = { onRemoveItem(cartItem.product.id) }
                            )
                        }
                    }

                    // Bottom Summary Panel
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp),
                        colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
                        elevation = CardDefaults.cardElevation(defaultElevation = 8.dp)
                    ) {
                        Column(modifier = Modifier.padding(18.dp)) {
                            // Subtotal & Discount Row
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Column {
                                    Text("Subtotal", fontSize = 12.sp, color = TextMuted)
                                    Text(
                                        text = String.format("$ %,.2f", subtotal).replace(",", "X").replace(".", ",").replace("X", "."),
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = TextDark
                                    )
                                }

                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text("Desc. %", fontSize = 12.sp, color = TextMuted)
                                    Spacer(modifier = Modifier.width(6.dp))
                                    OutlinedTextField(
                                        value = state.generalDiscountPercent,
                                        onValueChange = onDiscountChange,
                                        singleLine = true,
                                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                        modifier = Modifier.width(70.dp),
                                        shape = RoundedCornerShape(8.dp),
                                        colors = OutlinedTextFieldDefaults.colors(
                                            focusedBorderColor = AccentBlue,
                                            unfocusedBorderColor = LineBorder
                                        )
                                    )
                                }
                            }

                            Spacer(modifier = Modifier.height(10.dp))
                            HorizontalDivider(color = LineBorder)
                            Spacer(modifier = Modifier.height(10.dp))

                            // Total Big Row
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = "TOTAL",
                                    fontSize = 18.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    color = NavyPrimary
                                )

                                Text(
                                    text = String.format("$ %,.2f", total).replace(",", "X").replace(".", ",").replace("X", "."),
                                    fontSize = 22.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    color = AccentBlue
                                )
                            }

                            Spacer(modifier = Modifier.height(14.dp))

                            if (state.errorMessage != null) {
                                Text(
                                    text = state.errorMessage,
                                    color = AlertRed,
                                    fontSize = 12.sp,
                                    modifier = Modifier.padding(bottom = 8.dp)
                                )
                            }

                            Button(
                                onClick = if (isOrderMode) onSubmitOrder else onSubmitSale,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(52.dp),
                                enabled = !state.isSubmittingSale,
                                shape = RoundedCornerShape(12.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = AccentBlue)
                            ) {
                                if (state.isSubmittingSale) {
                                    CircularProgressIndicator(
                                        color = Color.White,
                                        modifier = Modifier.size(22.dp),
                                        strokeWidth = 2.dp
                                    )
                                } else {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(Icons.Default.Check, contentDescription = null, tint = Color.White)
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text(
                                            text = if (isOrderMode) "GUARDAR PEDIDO DE VENTA" else "REGISTRAR VENTA EN PC",
                                            fontSize = 15.sp,
                                            fontWeight = FontWeight.ExtraBold
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun CartItemRow(
    item: CartItem,
    onUpdateQty: (Double) -> Unit,
    onRemove: () -> Unit
) {
    var qtyInput by remember(item.quantity) {
        mutableStateOf(if (item.quantity % 1.0 == 0.0) item.quantity.toLong().toString() else item.quantity.toString())
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp)),
        colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = item.product.name,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextDark
                )
                Text(
                    text = "${item.product.getFormattedPrice()} / c.u.",
                    fontSize = 12.sp,
                    color = TextMuted
                )
                Text(
                    text = "Subtotal: ${item.getFormattedSubtotal()}",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    color = NavyPrimary
                )
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                FilledIconButton(
                    onClick = {
                        val current = qtyInput.toDoubleOrNull() ?: item.quantity
                        val newQty = (current - 1.0).coerceAtLeast(1.0)
                        qtyInput = if (newQty % 1.0 == 0.0) newQty.toLong().toString() else newQty.toString()
                        onUpdateQty(newQty)
                    },
                    modifier = Modifier.size(32.dp),
                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = BackgroundLight)
                ) {
                    Icon(Icons.Default.Remove, contentDescription = "Restar", tint = TextDark, modifier = Modifier.size(16.dp))
                }

                OutlinedTextField(
                    value = qtyInput,
                    onValueChange = { input ->
                        qtyInput = input
                        val parsed = input.toDoubleOrNull()
                        if (parsed != null && parsed > 0) {
                            onUpdateQty(parsed)
                        }
                    },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier
                        .width(65.dp)
                        .padding(horizontal = 4.dp),
                    shape = RoundedCornerShape(8.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = AccentBlue,
                        unfocusedBorderColor = LineBorder
                    )
                )

                FilledIconButton(
                    onClick = {
                        val current = qtyInput.toDoubleOrNull() ?: item.quantity
                        val newQty = current + 1.0
                        qtyInput = if (newQty % 1.0 == 0.0) newQty.toLong().toString() else newQty.toString()
                        onUpdateQty(newQty)
                    },
                    modifier = Modifier.size(32.dp),
                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = AccentSoft)
                ) {
                    Icon(Icons.Default.Add, contentDescription = "Sumar", tint = AccentBlue, modifier = Modifier.size(16.dp))
                }

                Spacer(modifier = Modifier.width(6.dp))

                IconButton(
                    onClick = onRemove,
                    modifier = Modifier.size(32.dp)
                ) {
                    Icon(Icons.Default.Close, contentDescription = "Eliminar", tint = AlertRed, modifier = Modifier.size(18.dp))
                }
            }
        }
    }
}
