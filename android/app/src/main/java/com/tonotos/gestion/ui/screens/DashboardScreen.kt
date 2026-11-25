package com.tonotos.gestion.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
fun DashboardScreen(
    state: UiState,
    onRefresh: () -> Unit,
    onOpenCashRegisterDialog: () -> Unit
) {
    val stats = state.dashboardData?.stats
    val lowStockList = state.dashboardData?.lowStockProducts ?: emptyList()
    val isCashOpen = state.cashRegisterSession != null

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Panel / Resumen", fontWeight = FontWeight.Bold, color = NavyPrimary) },
                actions = {
                    IconButton(onClick = onRefresh) {
                        Icon(Icons.Default.Refresh, contentDescription = "Actualizar", tint = NavyPrimary)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SurfaceWhite)
            )
        }
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .background(BackgroundLight)
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            val isSeller = state.currentUser?.role == "seller"

            // Cash Register Quick Card (solo si no es vendedor)
            if (!isSeller) {
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
                        shape = RoundedCornerShape(14.dp),
                        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Column {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(
                                        imageVector = if (isCashOpen) Icons.Default.LockOpen else Icons.Default.Lock,
                                        contentDescription = null,
                                        tint = if (isCashOpen) StockGreen else AlertRed,
                                        modifier = Modifier.size(20.dp)
                                    )
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text(
                                        text = if (isCashOpen) "Caja Abierta" else "Caja Cerrada",
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 15.sp,
                                        color = NavyPrimary
                                    )
                                }
                                if (isCashOpen && state.cashRegisterSession != null) {
                                    Text(
                                        text = "Efectivo estimado: ${String.format("$ %,.2f", state.cashRegisterSession.expectedCash)}",
                                        fontSize = 12.sp,
                                        color = TextMuted
                                    )
                                }
                            }

                            Button(
                                onClick = onOpenCashRegisterDialog,
                                shape = RoundedCornerShape(10.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = if (isCashOpen) AlertRed else StockGreen
                                )
                            ) {
                                Text(if (isCashOpen) "Gestionar Caja" else "Abrir Caja", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }

            // Overview Stats Grid
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    StatCard(
                        title = "Ventas del Mes",
                        value = String.format("$ %,.2f", stats?.sales ?: 0.0),
                        icon = Icons.Default.TrendingUp,
                        iconColor = StockGreen,
                        modifier = Modifier.weight(1f)
                    )
                    StatCard(
                        title = "Productos",
                        value = "${stats?.products ?: state.products.size}",
                        icon = Icons.Default.Inventory2,
                        iconColor = AccentBlue,
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            // Low Stock Alert Banner / List
            item {
                Text(
                    text = "Alertas de Stock Bajo (${lowStockList.size})",
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    color = NavyPrimary
                )
            }

            if (lowStockList.isEmpty()) {
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Text(
                            text = "¡Excelente! No hay productos con stock por debajo del mínimo.",
                            fontSize = 13.sp,
                            color = StockGreen,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(16.dp)
                        )
                    }
                }
            } else {
                items(lowStockList, key = { it.id }) { product ->
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Column {
                                Text(product.name, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                                Text("SKU: ${product.sku}", fontSize = 11.sp, color = TextMuted)
                            }
                            Surface(color = Color(0xFFFDE8E8), shape = RoundedCornerShape(6.dp)) {
                                Text(
                                    text = "Stock: ${product.getNumericStock().toInt()}",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = AlertRed,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun StatCard(
    title: String,
    value: String,
    icon: ImageVector,
    iconColor: Color,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Icon(imageVector = icon, contentDescription = null, tint = iconColor, modifier = Modifier.size(24.dp))
            Spacer(modifier = Modifier.height(8.dp))
            Text(title, fontSize = 11.sp, color = TextMuted)
            Text(value, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold, color = NavyPrimary)
        }
    }
}
