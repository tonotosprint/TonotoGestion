package com.tonotos.gestion.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tonotos.gestion.ui.theme.*
import com.tonotos.gestion.ui.viewmodel.UiState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    state: UiState,
    onNavigateTo: (String) -> Unit,
    onOpenHamburgerMenu: () -> Unit,
    onOpenCashRegisterDialog: () -> Unit
) {
    val cartCount = state.cartItems.sumOf { it.quantity }.toInt()
    val isCashOpen = state.cashRegisterSession != null

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "Tonotos Gestión",
                            fontWeight = FontWeight.ExtraBold,
                            color = NavyPrimary,
                            fontSize = 18.sp
                        )
                        Text(
                            text = state.currentUser?.company ?: "Sistema Móvil",
                            fontSize = 12.sp,
                            color = TextMuted
                        )
                    }
                },
                actions = {
                    IconButton(onClick = onOpenHamburgerMenu) {
                        Icon(
                            imageVector = Icons.Default.Menu,
                            contentDescription = "Menú",
                            tint = NavyPrimary,
                            modifier = Modifier.size(28.dp)
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SurfaceWhite)
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .background(BackgroundLight)
                .padding(16.dp)
        ) {
            // Header Banner
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = NavyPrimary)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column {
                        Text(
                            text = "¡Hola, ${state.currentUser?.displayName ?: "Usuario"}!",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            color = SurfaceWhite
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(StockGreen)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "Conectado a PC: ${state.serverUrl}",
                                fontSize = 12.sp,
                                color = SurfaceWhite.copy(alpha = 0.8f)
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "Módulos del Sistema",
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = NavyPrimary,
                modifier = Modifier.padding(start = 4.dp, bottom = 12.dp)
            )

            // Mosaico / Grid de Módulos
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                item {
                    ModuleTile(
                        title = "Productos",
                        subtitle = "${state.products.size} en catálogo",
                        icon = Icons.Default.Store,
                        accentColor = AccentBlue,
                        badgeCount = null,
                        onClick = { onNavigateTo("productos") }
                    )
                }

                val isSeller = state.currentUser?.role == "seller"

                item {
                    ModuleTile(
                        title = if (isSeller) "Nuevo Pedido" else "Nueva Venta",
                        subtitle = if (cartCount > 0) "$cartCount ítem(s) en carrito" else "Armar pedido de venta",
                        icon = Icons.Default.ShoppingCart,
                        accentColor = StockGreen,
                        badgeCount = if (cartCount > 0) cartCount else null,
                        onClick = { onNavigateTo("venta") }
                    )
                }

                item {
                    ModuleTile(
                        title = "Clientes",
                        subtitle = "${state.customers.size} registrados",
                        icon = Icons.Default.People,
                        accentColor = Color(0xFF8E24AA),
                        badgeCount = null,
                        onClick = { onNavigateTo("clientes") }
                    )
                }

                item {
                    ModuleTile(
                        title = "Historial / Pedidos",
                        subtitle = "${state.salesOrders.size} pedidos abiertos",
                        icon = Icons.Default.ReceiptLong,
                        accentColor = Color(0xFFF57C00),
                        badgeCount = if (state.pendingSyncCount > 0) state.pendingSyncCount else null,
                        onClick = { onNavigateTo("historial") }
                    )
                }

                if (!isSeller) {
                    item {
                        ModuleTile(
                            title = "Control de Caja",
                            subtitle = if (isCashOpen) "Caja Abierta" else "Caja Cerrada",
                            icon = if (isCashOpen) Icons.Default.LockOpen else Icons.Default.Lock,
                            accentColor = if (isCashOpen) StockGreen else AlertRed,
                            badgeCount = null,
                            onClick = onOpenCashRegisterDialog
                        )
                    }
                }

                item {
                    ModuleTile(
                        title = "Lector de Barras",
                        subtitle = "Escanear lotes a PC",
                        icon = Icons.Default.QrCodeScanner,
                        accentColor = Color(0xFFE91E63),
                        badgeCount = null,
                        onClick = { onNavigateTo("lector") }
                    )
                }

                item {
                    ModuleTile(
                        title = "Panel / Reportes",
                        subtitle = "Resumen diario y stock",
                        icon = Icons.Default.Dashboard,
                        accentColor = Color(0xFF00ACC1),
                        badgeCount = null,
                        onClick = { onNavigateTo("panel") }
                    )
                }
            }
        }
    }
}

@Composable
fun ModuleTile(
    title: String,
    subtitle: String,
    icon: ImageVector,
    accentColor: Color,
    badgeCount: Int?,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .height(130.dp)
            .clip(RoundedCornerShape(16.dp))
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
        elevation = CardDefaults.cardElevation(defaultElevation = 3.dp)
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(14.dp),
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                Surface(
                    color = accentColor.copy(alpha = 0.12f),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.size(42.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = icon,
                            contentDescription = null,
                            tint = accentColor,
                            modifier = Modifier.size(24.dp)
                        )
                    }
                }

                Column {
                    Text(
                        text = title,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextDark
                    )
                    Text(
                        text = subtitle,
                        fontSize = 11.sp,
                        color = TextMuted,
                        maxLines = 1
                    )
                }
            }

            if (badgeCount != null) {
                Surface(
                    color = AlertRed,
                    shape = CircleShape,
                    modifier = Modifier
                        .padding(10.dp)
                        .align(Alignment.TopEnd)
                ) {
                    Text(
                        text = badgeCount.toString(),
                        color = Color.White,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp)
                    )
                }
            }
        }
    }
}
