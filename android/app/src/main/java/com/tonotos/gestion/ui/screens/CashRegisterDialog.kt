package com.tonotos.gestion.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.tonotos.gestion.data.model.CashRegisterSession
import com.tonotos.gestion.ui.theme.*

@Composable
fun CashRegisterDialog(
    session: CashRegisterSession?,
    onDismiss: () -> Unit,
    onOpenCash: (String) -> Unit,
    onCloseCash: (String) -> Unit
) {
    var amountInput by remember { mutableStateOf("") }
    val isOpen = session != null

    Dialog(onDismissRequest = onDismiss) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = SurfaceWhite)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = if (isOpen) Icons.Default.LockOpen else Icons.Default.Lock,
                        contentDescription = null,
                        tint = if (isOpen) StockGreen else AlertRed,
                        modifier = Modifier.size(28.dp)
                    )
                    Text(
                        text = if (isOpen) "Caja Abierta" else "Caja Cerrada",
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        color = NavyPrimary
                    )
                }

                Spacer(modifier = Modifier.height(16.dp))

                if (isOpen && session != null) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(BackgroundLight, RoundedCornerShape(10.dp))
                            .padding(14.dp)
                    ) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("Abierta por:", fontSize = 12.sp, color = TextMuted)
                            Text(session.openedBy ?: "Usuario", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("Monto Inicial:", fontSize = 12.sp, color = TextMuted)
                            Text(String.format("$ %,.2f", session.openingAmount), fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("Ventas en Efectivo:", fontSize = 12.sp, color = TextMuted)
                            Text(String.format("$ %,.2f", session.cashSales), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = StockGreen)
                        }
                        Spacer(modifier = Modifier.height(6.dp))
                        HorizontalDivider(color = LineBorder)
                        Spacer(modifier = Modifier.height(6.dp))
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("Efectivo Esperado:", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = NavyPrimary)
                            Text(String.format("$ %,.2f", session.expectedCash), fontSize = 16.sp, fontWeight = FontWeight.ExtraBold, color = AccentBlue)
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    OutlinedTextField(
                        value = amountInput,
                        onValueChange = { amountInput = it },
                        label = { Text("Monto contado al cierre ($)") },
                        placeholder = { Text(session.expectedCash.toString()) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )

                    Spacer(modifier = Modifier.height(20.dp))

                    Button(
                        onClick = {
                            val closing = amountInput.ifBlank { session.expectedCash.toString() }
                            onCloseCash(closing)
                        },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = AlertRed)
                    ) {
                        Text("Cerrar Caja", fontWeight = FontWeight.Bold)
                    }
                } else {
                    Text(
                        text = "Para registrar ventas directa en la PC o sincronizar datos, ingresá el monto de inicio de caja:",
                        fontSize = 13.sp,
                        color = TextMuted
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    OutlinedTextField(
                        value = amountInput,
                        onValueChange = { amountInput = it },
                        label = { Text("Monto inicial ($)") },
                        placeholder = { Text("0.00") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )

                    Spacer(modifier = Modifier.height(20.dp))

                    Button(
                        onClick = {
                            val opening = amountInput.ifBlank { "0" }
                            onOpenCash(opening)
                        },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = StockGreen)
                    ) {
                        Text("Abrir Caja", fontWeight = FontWeight.Bold)
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                    Text("Volver", color = TextMuted)
                }
            }
        }
    }
}
