package com.tonotos.gestion.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tonotos.gestion.data.model.SalesOrder
import com.tonotos.gestion.data.model.Transaction
import com.tonotos.gestion.ui.theme.*
import com.tonotos.gestion.ui.viewmodel.UiState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HistoryScreen(
    state: UiState,
    onRefresh: () -> Unit,
    onConvertOrder: (Int) -> Unit = {},
    onCancelOrder: (Int) -> Unit = {}
) {
    var selectedTab by remember { mutableIntStateOf(0) }

    Scaffold(
        topBar = {
            Column {
                TopAppBar(
                    title = {
                        Text(
                            text = "Historial y Pedidos",
                            fontWeight = FontWeight.Bold,
                            color = NavyPrimary
                        )
                    },
                    actions = {
                        IconButton(onClick = onRefresh) {
                            Icon(Icons.Default.Refresh, contentDescription = "Actualizar", tint = NavyPrimary)
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = SurfaceWhite)
                )

                TabRow(
                    selectedTabIndex = selectedTab,
                    containerColor = SurfaceWhite,
                    contentColor = AccentBlue
                ) {
                    Tab(
                        selected = selectedTab == 0,
                        onClick = { selectedTab = 0 },
                        text = { Text("Ventas (${state.recentTransactions.size})", fontWeight = FontWeight.Bold) }
                    )
                    Tab(
                        selected = selectedTab == 1,
                        onClick = { selectedTab = 1 },
                        text = { Text("Pedidos (${state.salesOrders.size})", fontWeight = FontWeight.Bold) }
                    )
                }
            }
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .background(BackgroundLight)
        ) {
            if (selectedTab == 0) {
                // Ventas Tab
                if (state.recentTransactions.isEmpty()) {
                    EmptyHistoryView(message = "No hay ventas registradas aún")
                } else {
                    LazyColumn(
                        contentPadding = PaddingValues(12.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        items(state.recentTransactions, key = { it.id }) { tx ->
                            TransactionCard(transaction = tx)
                        }
                    }
                }
            } else {
                // Pedidos Tab
                if (state.salesOrders.isEmpty()) {
                    EmptyHistoryView(message = "No hay pedidos de venta registrados")
                } else {
                    LazyColumn(
                        contentPadding = PaddingValues(12.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        items(state.salesOrders, key = { it.id }) { order ->
                            SalesOrderCard(
                                order = order,
                                canConvert = state.currentUser?.role != "seller",
                                onConvert = { onConvertOrder(order.id) },
                                onCancel = { onCancelOrder(order.id) }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun EmptyHistoryView(message: String) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.ReceiptLong,
            contentDescription = null,
            tint = TextMuted,
            modifier = Modifier.size(64.dp)
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = message,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            color = NavyPrimary
        )
    }
}

@Composable
fun TransactionCard(transaction: Transaction) {
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
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Surface(
                    color = AccentSoft,
                    shape = RoundedCornerShape(6.dp)
                ) {
                    Text(
                        text = "Venta #${transaction.id}",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = AccentBlue,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                    )
                }

                Text(
                    text = transaction.getFormattedTotal(),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = NavyPrimary
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "Cliente: ${transaction.contact.ifBlank { "Consumidor final" }}",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = TextDark
            )

            if (!transaction.createdAt.isNullOrEmpty()) {
                Text(
                    text = transaction.createdAt,
                    fontSize = 11.sp,
                    color = TextMuted
                )
            }

            if (transaction.items.isNotEmpty()) {
                Spacer(modifier = Modifier.height(6.dp))
                HorizontalDivider(color = LineBorder)
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "${transaction.items.size} producto(s): ${transaction.items.joinToString { it.name }}",
                    fontSize = 12.sp,
                    color = TextMuted,
                    maxLines = 2
                )
            }
        }
    }
}

@Composable
fun SalesOrderCard(
    order: SalesOrder,
    canConvert: Boolean = true,
    onConvert: () -> Unit,
    onCancel: () -> Unit
) {
    val isOpen = order.status == "open"

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
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Surface(
                    color = if (isOpen) Color(0xFFFFF8E1) else BackgroundLight,
                    shape = RoundedCornerShape(6.dp)
                ) {
                    Text(
                        text = "Pedido #${order.number}",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = if (isOpen) Color(0xFFF57F17) else TextMuted,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                    )
                }

                Text(
                    text = order.getFormattedTotal(),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = NavyPrimary
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "Cliente: ${order.contact}",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = TextDark
            )

            if (isOpen) {
                Spacer(modifier = Modifier.height(10.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = onCancel,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = AlertRed)
                    ) {
                        Icon(Icons.Default.Close, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Cancelar", fontSize = 12.sp)
                    }

                    if (canConvert) {
                        Button(
                            onClick = onConvert,
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = StockGreen)
                        ) {
                            Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Facturar", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}
