package com.tonotos.gestion

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.tonotos.gestion.ui.screens.*
import com.tonotos.gestion.ui.theme.*
import com.tonotos.gestion.ui.viewmodel.TonotosViewModel
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            TonotosTheme {
                MainAppScreen()
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainAppScreen(
    viewModel: TonotosViewModel = viewModel()
) {
    val state by viewModel.uiState.collectAsState()
    var currentTab by remember { mutableStateOf("inicio") }
    var forceShowConfigScreen by remember { mutableStateOf(false) }
    var scanTarget by remember { mutableStateOf("search") }
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val coroutineScope = rememberCoroutineScope()
    val context = LocalContext.current

    // Handle toast notifications
    LaunchedEffect(state.successMessage) {
        state.successMessage?.let {
            Toast.makeText(context, it, Toast.LENGTH_SHORT).show()
            viewModel.dismissMessages()
        }
    }

    LaunchedEffect(state.errorMessage) {
        state.errorMessage?.let {
            Toast.makeText(context, it, Toast.LENGTH_LONG).show()
            viewModel.dismissMessages()
        }
    }

    if (forceShowConfigScreen || !state.isServerConnected) {
        ServerConfigScreen(
            state = state,
            onTestAndSave = { url -> viewModel.testAndSaveServerUrl(url) },
            onContinueToLogin = { forceShowConfigScreen = false }
        )
    } else if (!state.isLoggedIn) {
        LoginScreen(
            state = state,
            onLogin = { email, pass -> viewModel.login(email, pass) },
            onChangeServer = { forceShowConfigScreen = true }
        )
    } else {
        ModalNavigationDrawer(
            drawerState = drawerState,
            drawerContent = {
                ModalDrawerSheet(
                    drawerContainerColor = SurfaceWhite,
                    modifier = Modifier.width(280.dp)
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(NavyPrimary)
                            .padding(20.dp)
                    ) {
                        Text(
                            text = "Tonotos Gestión",
                            fontSize = 20.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = SurfaceWhite
                        )
                        Text(
                            text = state.currentUser?.displayName ?: "Usuario",
                            fontSize = 13.sp,
                            color = SurfaceWhite.copy(alpha = 0.8f)
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = state.currentUser?.company ?: "PC Local",
                            fontSize = 11.sp,
                            color = StockGreen,
                            fontWeight = FontWeight.SemiBold
                        )
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    NavigationDrawerItem(
                        icon = { Icon(Icons.Default.Home, contentDescription = null) },
                        label = { Text("Inicio (Mosaico)", fontWeight = FontWeight.Bold) },
                        selected = currentTab == "inicio",
                        onClick = {
                            currentTab = "inicio"
                            coroutineScope.launch { drawerState.close() }
                        },
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp)
                    )

                    NavigationDrawerItem(
                        icon = { Icon(Icons.Default.Store, contentDescription = null) },
                        label = { Text("Productos", fontWeight = FontWeight.Bold) },
                        selected = currentTab == "productos",
                        onClick = {
                            currentTab = "productos"
                            coroutineScope.launch { drawerState.close() }
                        },
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp)
                    )

                    NavigationDrawerItem(
                        icon = { Icon(Icons.Default.ShoppingCart, contentDescription = null) },
                        label = { Text("Nueva Venta / Pedido", fontWeight = FontWeight.Bold) },
                        selected = currentTab == "venta",
                        onClick = {
                            currentTab = "venta"
                            coroutineScope.launch { drawerState.close() }
                        },
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp)
                    )

                    NavigationDrawerItem(
                        icon = { Icon(Icons.Default.People, contentDescription = null) },
                        label = { Text("Clientes", fontWeight = FontWeight.Bold) },
                        selected = currentTab == "clientes",
                        onClick = {
                            currentTab = "clientes"
                            coroutineScope.launch { drawerState.close() }
                        },
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp)
                    )

                    NavigationDrawerItem(
                        icon = { Icon(Icons.Default.ReceiptLong, contentDescription = null) },
                        label = { Text("Historial y Pedidos", fontWeight = FontWeight.Bold) },
                        selected = currentTab == "historial",
                        onClick = {
                            currentTab = "historial"
                            coroutineScope.launch { drawerState.close() }
                        },
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp)
                    )

                    if (state.currentUser?.role != "seller") {
                        NavigationDrawerItem(
                            icon = { Icon(Icons.Default.LockOpen, contentDescription = null) },
                            label = { Text("Control de Caja", fontWeight = FontWeight.Bold) },
                            selected = false,
                            onClick = {
                                coroutineScope.launch { drawerState.close() }
                                viewModel.openCashRegisterDialog()
                            },
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp)
                        )
                    }

                    NavigationDrawerItem(
                        icon = { Icon(Icons.Default.QrCodeScanner, contentDescription = null) },
                        label = { Text("Lector de Barras", fontWeight = FontWeight.Bold) },
                        selected = currentTab == "lector",
                        onClick = {
                            currentTab = "lector"
                            coroutineScope.launch { drawerState.close() }
                        },
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp)
                    )

                    NavigationDrawerItem(
                        icon = { Icon(Icons.Default.Dashboard, contentDescription = null) },
                        label = { Text("Panel / Reportes", fontWeight = FontWeight.Bold) },
                        selected = currentTab == "panel",
                        onClick = {
                            currentTab = "panel"
                            coroutineScope.launch { drawerState.close() }
                        },
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp)
                    )

                    HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp), color = LineBorder)

                    NavigationDrawerItem(
                        icon = { Icon(Icons.Default.Computer, contentDescription = null) },
                        label = { Text("Conexión PC Local", fontWeight = FontWeight.Bold) },
                        selected = false,
                        onClick = {
                            coroutineScope.launch { drawerState.close() }
                            forceShowConfigScreen = true
                        },
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp)
                    )

                    NavigationDrawerItem(
                        icon = { Icon(Icons.Default.ExitToApp, contentDescription = null) },
                        label = { Text("Cerrar Sesión", fontWeight = FontWeight.Bold, color = AlertRed) },
                        selected = false,
                        onClick = {
                            coroutineScope.launch { drawerState.close() }
                            viewModel.logout()
                        },
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp)
                    )
                }
            }
        ) {
            Scaffold(
                bottomBar = {
                    NavigationBar(
                        containerColor = SurfaceWhite,
                        tonalElevation = 8.dp
                    ) {
                        val cartCount = state.cartItems.sumOf { it.quantity }.toInt()

                        NavigationBarItem(
                            selected = currentTab == "inicio",
                            onClick = { currentTab = "inicio" },
                            icon = { Icon(Icons.Default.Home, contentDescription = "Inicio") },
                            label = { Text("Inicio", fontWeight = FontWeight.Bold) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = AccentBlue,
                                selectedTextColor = AccentBlue,
                                indicatorColor = Color(0xFFEEF0FF)
                            )
                        )

                        NavigationBarItem(
                            selected = currentTab == "productos",
                            onClick = { currentTab = "productos" },
                            icon = { Icon(Icons.Default.Store, contentDescription = "Productos") },
                            label = { Text("Productos", fontWeight = FontWeight.Bold) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = AccentBlue,
                                selectedTextColor = AccentBlue,
                                indicatorColor = Color(0xFFEEF0FF)
                            )
                        )

                        NavigationBarItem(
                            selected = currentTab == "venta",
                            onClick = { currentTab = "venta" },
                            icon = {
                                if (cartCount > 0) {
                                    BadgedBox(badge = { Badge { Text(cartCount.toString()) } }) {
                                        Icon(Icons.Default.ShoppingCart, contentDescription = "Venta")
                                    }
                                } else {
                                    Icon(Icons.Default.ShoppingCart, contentDescription = "Venta")
                                }
                            },
                            label = { Text("Venta", fontWeight = FontWeight.Bold) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = AccentBlue,
                                selectedTextColor = AccentBlue,
                                indicatorColor = Color(0xFFEEF0FF)
                            )
                        )

                        NavigationBarItem(
                            selected = currentTab == "clientes",
                            onClick = { currentTab = "clientes" },
                            icon = { Icon(Icons.Default.People, contentDescription = "Clientes") },
                            label = { Text("Clientes", fontWeight = FontWeight.Bold) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = AccentBlue,
                                selectedTextColor = AccentBlue,
                                indicatorColor = Color(0xFFEEF0FF)
                            )
                        )

                        NavigationBarItem(
                            selected = currentTab == "panel",
                            onClick = { currentTab = "panel" },
                            icon = { Icon(Icons.Default.Dashboard, contentDescription = "Panel") },
                            label = { Text("Panel", fontWeight = FontWeight.Bold) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = AccentBlue,
                                selectedTextColor = AccentBlue,
                                indicatorColor = Color(0xFFEEF0FF)
                            )
                        )
                    }
                }
            ) { paddingValues ->
                Box(modifier = Modifier.padding(paddingValues)) {
                    when (currentTab) {
                        "inicio" -> HomeScreen(
                            state = state,
                            onNavigateTo = { tab -> currentTab = tab },
                            onOpenHamburgerMenu = { coroutineScope.launch { drawerState.open() } },
                            onOpenCashRegisterDialog = { viewModel.openCashRegisterDialog() }
                        )

                        "productos" -> ProductsScreen(
                            state = state,
                            onSearchQueryChange = { viewModel.setSearchQuery(it) },
                            onSelectCategory = { viewModel.setSelectedCategory(it) },
                            onAddToCart = { product, qty -> viewModel.addToCart(product, qty) },
                            onAddProduct = { viewModel.openCreateProductDialog() },
                            onEditProduct = { product -> viewModel.openEditProductDialog(product) },
                            onRefresh = { viewModel.loadProducts() },
                            onGoToCart = { currentTab = "venta" },
                            onOpenHamburgerMenu = { coroutineScope.launch { drawerState.open() } },
                            onOpenScanner = {
                                scanTarget = "search"
                                viewModel.openBarcodeScanner()
                            }
                        )

                        "venta" -> CartSalesScreen(
                            state = state,
                            onCustomerNameChange = { viewModel.setCustomerName(it) },
                            onSelectCustomer = { customer -> viewModel.selectCustomer(customer) },
                            onPaymentMethodChange = { viewModel.setPaymentMethod(it) },
                            onDiscountChange = { viewModel.setGeneralDiscount(it) },
                            onUpdateQuantity = { id, qty -> viewModel.updateCartQuantity(id, qty) },
                            onRemoveItem = { id -> viewModel.removeFromCart(id) },
                            onClearCart = { viewModel.clearCart() },
                            onSubmitSale = { viewModel.submitSale() },
                            onSubmitOrder = { viewModel.submitSalesOrder() },
                            onGoToProducts = { currentTab = "productos" },
                            onOpenHamburgerMenu = { coroutineScope.launch { drawerState.open() } },
                            onOpenScanner = {
                                scanTarget = "cart"
                                viewModel.openBarcodeScanner()
                            }
                        )

                        "clientes" -> CustomersScreen(
                            state = state,
                            onRefresh = { viewModel.loadCustomers() },
                            onAddCustomer = { viewModel.openCreateCustomerDialog() },
                            onEditCustomer = { customer -> viewModel.openEditCustomerDialog(customer) }
                        )

                        "historial" -> HistoryScreen(
                            state = state,
                            onRefresh = {
                                viewModel.loadRecentTransactions()
                                viewModel.loadSalesOrders()
                            },
                            onConvertOrder = { orderId -> viewModel.convertSalesOrder(orderId) },
                            onCancelOrder = { orderId -> viewModel.cancelSalesOrder(orderId) }
                        )

                        "lector" -> BarcodeScannerModuleScreen(
                            state = state,
                            onOpenHamburgerMenu = { coroutineScope.launch { drawerState.open() } },
                            onLiveScan = { code -> viewModel.sendLiveScan(code) },
                            onSubmitBatchAsOrder = { batch -> viewModel.submitBatchAsOrder(batch) },
                            onSubmitBatchAsSale = { batch -> viewModel.submitBatchAsSale(batch) }
                        )

                        "panel" -> DashboardScreen(
                            state = state,
                            onRefresh = { viewModel.loadDashboard() },
                            onOpenCashRegisterDialog = { viewModel.openCashRegisterDialog() }
                        )
                    }

                    // Dialogs
                    if (state.showReceiptDialog) {
                        ReceiptDialog(
                            transaction = state.lastCompletedTransaction,
                            onDismiss = {
                                viewModel.dismissReceiptDialog()
                                currentTab = "productos"
                            }
                        )
                    }

                    if (state.showProductDialog) {
                        ProductDialog(
                            product = state.editingProduct,
                            onDismiss = { viewModel.closeProductDialog() },
                            onSave = { req -> viewModel.saveProduct(req, state.editingProduct?.id) },
                            onDelete = { id -> viewModel.deleteProduct(id) }
                        )
                    }

                    if (state.showCustomerDialog) {
                        CustomerDialog(
                            customer = state.editingCustomer,
                            onDismiss = { viewModel.closeCustomerDialog() },
                            onSave = { req -> viewModel.saveCustomer(req, state.editingCustomer?.id) },
                            onDelete = { id -> viewModel.deleteCustomer(id) }
                        )
                    }

                    if (state.showCashRegisterDialog) {
                        CashRegisterDialog(
                            session = state.cashRegisterSession,
                            onDismiss = { viewModel.closeCashRegisterDialog() },
                            onOpenCash = { amount -> viewModel.openCashRegister(amount) },
                            onCloseCash = { amount -> viewModel.closeCashRegister(amount) }
                        )
                    }

                    if (state.showBarcodeScanner) {
                        BarcodeScannerDialog(
                            onDismiss = { viewModel.closeBarcodeScanner() },
                            onBarcodeScanned = { code ->
                                viewModel.closeBarcodeScanner()
                                if (scanTarget == "search") {
                                    viewModel.setSearchQuery(code)
                                } else {
                                    viewModel.scanAndAddToCart(code)
                                }
                            }
                        )
                    }
                }
            }
        }
    }
}
