package com.tonotos.gestion.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.mlkit.vision.MlKitAnalyzer
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.tonotos.gestion.data.model.Product
import com.tonotos.gestion.ui.theme.*
import com.tonotos.gestion.ui.viewmodel.UiState
import java.util.concurrent.Executors

data class ScannedBatchItem(
    val product: Product,
    var quantity: Double = 1.0
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BarcodeScannerModuleScreen(
    state: UiState,
    onOpenHamburgerMenu: () -> Unit,
    onLiveScan: (String) -> Unit = {},
    onSubmitBatchAsOrder: (List<ScannedBatchItem>) -> Unit,
    onSubmitBatchAsSale: (List<ScannedBatchItem>) -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.CAMERA
            ) == PackageManager.PERMISSION_GRANTED
        )
    }

    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        hasCameraPermission = isGranted
    }

    LaunchedEffect(Unit) {
        if (!hasCameraPermission) {
            launcher.launch(Manifest.permission.CAMERA)
        }
    }

    var scannedItems by remember { mutableStateOf(listOf<ScannedBatchItem>()) }
    var lastScannedProduct by remember { mutableStateOf<Product?>(null) }
    var lastScannedCode by remember { mutableStateOf("") }

    fun processBarcode(code: String) {
        val trimmed = code.trim()
        onLiveScan(trimmed)

        val match = state.products.find {
            it.barcode.equals(trimmed, ignoreCase = true) || it.sku.equals(trimmed, ignoreCase = true)
        }
        if (match != null) {
            lastScannedProduct = match
            lastScannedCode = trimmed

            val currentList = scannedItems.toMutableList()
            val index = currentList.indexOfFirst { it.product.id == match.id }
            if (index >= 0) {
                currentList[index] = currentList[index].copy(quantity = currentList[index].quantity + 1.0)
            } else {
                currentList.add(ScannedBatchItem(product = match, quantity = 1.0))
            }
            scannedItems = currentList
        } else {
            lastScannedCode = trimmed
            lastScannedProduct = null
        }
    }

    val cameraExecutor = remember { Executors.newSingleThreadExecutor() }
    DisposableEffect(Unit) {
        onDispose {
            try {
                cameraExecutor.shutdown()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Lector Móvil de Barras", fontWeight = FontWeight.Bold, color = NavyPrimary) },
                actions = {
                    IconButton(onClick = onOpenHamburgerMenu) {
                        Icon(Icons.Default.Menu, contentDescription = "Menú", tint = NavyPrimary, modifier = Modifier.size(28.dp))
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
        ) {
            // Camera Scanner Box
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(200.dp)
                    .background(Color.Black),
                contentAlignment = Alignment.Center
            ) {
                if (hasCameraPermission) {
                    AndroidView(
                        factory = { ctx ->
                            val previewView = PreviewView(ctx)
                            val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)

                            cameraProviderFuture.addListener({
                                val cameraProvider = cameraProviderFuture.get()
                                val preview = Preview.Builder().build().also {
                                    it.setSurfaceProvider(previewView.surfaceProvider)
                                }

                                val barcodeScanner = BarcodeScanning.getClient()

                                val imageAnalysis = ImageAnalysis.Builder()
                                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                                    .build()

                                var lastTimeScanned = 0L

                                imageAnalysis.setAnalyzer(
                                    cameraExecutor,
                                    MlKitAnalyzer(
                                        listOf(barcodeScanner),
                                        ImageAnalysis.COORDINATE_SYSTEM_ORIGINAL,
                                        cameraExecutor
                                    ) { result ->
                                        val barcodeResults = result.getValue(barcodeScanner)
                                        val now = System.currentTimeMillis()
                                        if (!barcodeResults.isNullOrEmpty() && now - lastTimeScanned > 1200) {
                                            val scannedValue = barcodeResults.firstOrNull()?.rawValue
                                            if (scannedValue != null && scannedValue.isNotBlank()) {
                                                lastTimeScanned = now
                                                previewView.post {
                                                    processBarcode(scannedValue)
                                                }
                                            }
                                        }
                                    }
                                )

                                val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA

                                try {
                                    cameraProvider.unbindAll()
                                    cameraProvider.bindToLifecycle(
                                        lifecycleOwner,
                                        cameraSelector,
                                        preview,
                                        imageAnalysis
                                    )
                                } catch (e: Exception) {
                                    e.printStackTrace()
                                }
                            }, ContextCompat.getMainExecutor(ctx))

                            previewView
                        },
                        onRelease = { view ->
                            try {
                                val cameraProviderFuture = ProcessCameraProvider.getInstance(view.context)
                                if (cameraProviderFuture.isDone) {
                                    cameraProviderFuture.get().unbindAll()
                                } else {
                                    cameraProviderFuture.addListener({
                                        try {
                                            cameraProviderFuture.get().unbindAll()
                                        } catch (e: Exception) {
                                            e.printStackTrace()
                                        }
                                    }, ContextCompat.getMainExecutor(view.context))
                                }
                            } catch (e: Exception) {
                                e.printStackTrace()
                            }
                        },
                        modifier = Modifier.fillMaxSize()
                    )

                    Box(
                        modifier = Modifier
                            .size(220.dp, 100.dp)
                            .border(2.dp, AccentBlue, RoundedCornerShape(10.dp))
                    )
                } else {
                    Button(
                        onClick = { launcher.launch(Manifest.permission.CAMERA) },
                        colors = ButtonDefaults.buttonColors(containerColor = AccentBlue)
                    ) {
                        Text("Activar Cámara")
                    }
                }
            }

            // Scanned Product Preview Banner
            if (lastScannedProduct != null) {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "¡Producto Escaneado!",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                color = StockGreen
                            )
                            Text(
                                text = lastScannedProduct!!.name,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.Bold,
                                color = TextDark
                            )
                            Text(
                                text = "SKU: ${lastScannedProduct!!.sku} · Precio: ${lastScannedProduct!!.getFormattedPrice()}",
                                fontSize = 12.sp,
                                color = TextMuted
                            )
                        }

                        Surface(color = Color(0xFFE8F5E9), shape = RoundedCornerShape(6.dp)) {
                            Text(
                                text = "Stock: ${lastScannedProduct!!.getNumericStock().toInt()}",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = StockGreen,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                            )
                        }
                    }
                }
            } else if (lastScannedCode.isNotBlank()) {
                Surface(
                    color = Color(0xFFFDE8E8),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(
                        text = "Código $lastScannedCode no encontrado en el sistema",
                        color = AlertRed,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(12.dp)
                    )
                }
            }

            // Batch List Section Header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "Lote Escaneado (${scannedItems.sumOf { it.quantity }.toInt()})",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = NavyPrimary
                )

                if (scannedItems.isNotEmpty()) {
                    TextButton(onClick = { scannedItems = emptyList() }) {
                        Text("Limpiar Lote", color = AlertRed, fontSize = 12.sp)
                    }
                }
            }

            // List of scanned batch items with editable manual quantity
            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(scannedItems, key = { it.product.id }) { item ->
                    var itemQtyText by remember(item.quantity) {
                        mutableStateOf(if (item.quantity % 1.0 == 0.0) item.quantity.toLong().toString() else item.quantity.toString())
                    }

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
                            Column(modifier = Modifier.weight(1f)) {
                                Text(item.product.name, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                                Text("${item.product.getFormattedPrice()} c.u.", fontSize = 11.sp, color = TextMuted)
                            }

                            Row(verticalAlignment = Alignment.CenterVertically) {
                                FilledIconButton(
                                    onClick = {
                                        val current = itemQtyText.toDoubleOrNull() ?: item.quantity
                                        val newQty = (current - 1.0).coerceAtLeast(1.0)
                                        itemQtyText = if (newQty % 1.0 == 0.0) newQty.toLong().toString() else newQty.toString()
                                        scannedItems = scannedItems.map {
                                            if (it.product.id == item.product.id) it.copy(quantity = newQty) else it
                                        }
                                    },
                                    modifier = Modifier.size(28.dp),
                                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = BackgroundLight)
                                ) {
                                    Icon(Icons.Default.Remove, contentDescription = "Restar", tint = TextDark, modifier = Modifier.size(14.dp))
                                }

                                OutlinedTextField(
                                    value = itemQtyText,
                                    onValueChange = { input ->
                                        itemQtyText = input
                                        val parsed = input.toDoubleOrNull()
                                        if (parsed != null && parsed > 0) {
                                            scannedItems = scannedItems.map {
                                                if (it.product.id == item.product.id) it.copy(quantity = parsed) else it
                                            }
                                        }
                                    },
                                    singleLine = true,
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                    modifier = Modifier
                                        .width(62.dp)
                                        .padding(horizontal = 2.dp),
                                    shape = RoundedCornerShape(8.dp),
                                    colors = OutlinedTextFieldDefaults.colors(
                                        focusedBorderColor = AccentBlue,
                                        unfocusedBorderColor = LineBorder
                                    )
                                )

                                FilledIconButton(
                                    onClick = {
                                        val current = itemQtyText.toDoubleOrNull() ?: item.quantity
                                        val newQty = current + 1.0
                                        itemQtyText = if (newQty % 1.0 == 0.0) newQty.toLong().toString() else newQty.toString()
                                        scannedItems = scannedItems.map {
                                            if (it.product.id == item.product.id) it.copy(quantity = newQty) else it
                                        }
                                    },
                                    modifier = Modifier.size(28.dp),
                                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = AccentSoft)
                                ) {
                                    Icon(Icons.Default.Add, contentDescription = "Sumar", tint = AccentBlue, modifier = Modifier.size(14.dp))
                                }

                                Spacer(modifier = Modifier.width(6.dp))

                                IconButton(
                                    onClick = {
                                        scannedItems = scannedItems.filterNot { it.product.id == item.product.id }
                                    },
                                    modifier = Modifier.size(28.dp)
                                ) {
                                    Icon(Icons.Default.Close, contentDescription = "Quitar", tint = AlertRed, modifier = Modifier.size(16.dp))
                                }
                            }
                        }
                    }
                }
            }

            // Bottom Action Bar to Send Batch to PC
            if (scannedItems.isNotEmpty()) {
                Surface(
                    color = SurfaceWhite,
                    shadowElevation = 8.dp,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(14.dp)
                    ) {
                        Text(
                            text = "💡 Al enviar este lote, los productos ingresarán inmediatamente a la pantalla de la PC.",
                            fontSize = 11.sp,
                            color = TextMuted,
                            modifier = Modifier.padding(bottom = 8.dp)
                        )

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Button(
                                onClick = {
                                    onSubmitBatchAsOrder(scannedItems)
                                    scannedItems = emptyList()
                                },
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(10.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = AccentBlue)
                            ) {
                                Text("Cargar Pedido en PC", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                            }

                            if (state.currentUser?.role != "seller") {
                                Button(
                                    onClick = {
                                        onSubmitBatchAsSale(scannedItems)
                                        scannedItems = emptyList()
                                    },
                                    modifier = Modifier.weight(1f),
                                    shape = RoundedCornerShape(10.dp),
                                    colors = ButtonDefaults.buttonColors(containerColor = StockGreen)
                                ) {
                                    Text("Cargar y Facturar PC", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
