const industryCatalogs = {
  almacen: {
    name: "Almacén",
    groups: [
      {
        variants: ["500 g", "1 kg", "2 kg", "5 kg", "10 kg"],
        products: [
          "Arroz largo fino", "Arroz parboil", "Arroz integral", "Arroz doble carolina", "Azúcar blanca",
          "Azúcar rubia", "Harina de trigo 000", "Harina de trigo 0000", "Harina integral", "Polenta"
        ]
      },
      {
        variants: ["500 g", "1 kg", "2 kg", "3 kg", "5 kg"],
        products: [
          "Yerba mate", "Fideos tallarín", "Fideos tirabuzón", "Fideos codito", "Lentejas secas",
          "Porotos", "Garbanzos", "Avena arrollada", "Pan rallado", "Sal fina"
        ]
      },
      {
        variants: ["250 ml", "500 ml", "900 ml", "1.5 l", "2 l"],
        products: [
          "Aceite de girasol", "Aceite mezcla", "Vinagre de alcohol", "Vinagre de manzana", "Aceto balsámico",
          "Agua mineral", "Gaseosa cola", "Gaseosa lima limón", "Jugo de naranja", "Té frío"
        ]
      },
      {
        variants: ["Unidad", "Pack x2", "Pack x3", "Pack x6", "Caja x12"],
        products: [
          "Leche entera larga vida", "Leche descremada larga vida", "Leche chocolatada", "Crema de leche",
          "Dulce de leche", "Mermelada de durazno", "Mermelada de frutilla", "Mayonesa", "Ketchup", "Mostaza"
        ]
      }
    ]
  },
  ferreteria: {
    name: "Ferretería",
    groups: [
      {
        variants: ["4 x 20 mm", "4 x 30 mm", "5 x 40 mm", "6 x 50 mm", "8 x 60 mm"],
        products: [
          "Tornillo cabeza tanque", "Tornillo cabeza fresada", "Tornillo para madera", "Tornillo autoperforante",
          "Tornillo para chapa", "Tirafondo zincado", "Bulón hexagonal", "Bulón coche", "Varilla roscada", "Tarugo nylon"
        ]
      },
      {
        variants: ["10 mm", "13 mm", "17 mm", "19 mm", "22 mm"],
        products: [
          "Llave fija", "Llave combinada", "Llave tubo", "Llave crique", "Boca de llave tubo", "Mecha para metal",
          "Mecha para madera", "Mecha para pared", "Mecha copa", "Punta para atornillador"
        ]
      },
      {
        variants: ["Blanco", "Negro", "Rojo", "Azul", "Verde"],
        products: [
          "Cable unipolar 1.5 mm", "Cable unipolar 2.5 mm", "Cable taller", "Cinta aisladora", "Caja eléctrica",
          "Térmica bipolar", "Térmica unipolar", "Tomacorriente", "Interruptor de luz", "Portalámpara"
        ]
      },
      {
        variants: ["1/2 pulgada", "3/4 pulgada", "1 pulgada", "1 1/4 pulgadas", "1 1/2 pulgadas"],
        products: [
          "Caño PVC", "Codo PVC", "Tee PVC", "Unión PVC", "Cupla galvanizada", "Niple galvanizado",
          "Cinta teflón", "Canilla metálica", "Flexible para agua", "Válvula esférica"
        ]
      }
    ]
  },
  indumentaria: {
    name: "Indumentaria",
    groups: [
      {
        variants: ["Talle XS", "Talle S", "Talle M", "Talle L", "Talle XL"],
        products: [
          "Remera básica unisex", "Remera manga larga", "Chomba piqué", "Buzo cuello redondo", "Buzo con capucha",
          "Campera liviana", "Camisa manga corta", "Camisa manga larga", "Top deportivo", "Musculosa básica"
        ]
      },
      {
        variants: ["Talle 36", "Talle 38", "Talle 40", "Talle 42", "Talle 44"],
        products: [
          "Jean clásico", "Jean recto", "Pantalón de vestir", "Pantalón cargo", "Pantalón deportivo",
          "Calza lisa", "Short de jean", "Short deportivo", "Pollera de jean", "Pollera clásica"
        ]
      },
      {
        variants: ["Talle 35", "Talle 36", "Talle 37", "Talle 38", "Talle 39"],
        products: [
          "Zapatilla urbana", "Zapatilla deportiva", "Zapatilla lona", "Bota corta", "Borcego",
          "Sandalia baja", "Sandalia con plataforma", "Zapato clásico", "Ojota", "Pantufla"
        ]
      },
      {
        variants: ["Talle 1", "Talle 2", "Talle 3", "Talle 4", "Talle 5"],
        products: [
          "Medias cortas", "Medias deportivas", "Medias térmicas", "Ropa interior básica", "Boxer de algodón",
          "Corpiño clásico", "Pijama de algodón", "Delantal de trabajo", "Guantes de abrigo", "Gorra con visera"
        ]
      }
    ]
  },
  bazar: {
    name: "Bazar",
    groups: [
      {
        variants: ["Línea básica", "Línea clásica", "Línea moderna", "Línea premium", "Línea reforzada"],
        products: [
          "Plato playo", "Plato hondo", "Plato de postre", "Taza de desayuno", "Taza de café",
          "Compotera", "Bowl para ensalada", "Fuente rectangular", "Jarra para agua", "Ensaladera"
        ]
      },
      {
        variants: ["250 ml", "350 ml", "500 ml", "750 ml", "1 l"],
        products: [
          "Vaso de vidrio", "Vaso térmico", "Botella reutilizable", "Termo de acero", "Taza térmica",
          "Frasco hermético", "Frasco para especias", "Aceitera", "Vinagrera", "Azucarera"
        ]
      },
      {
        variants: ["20 cm", "24 cm", "26 cm", "28 cm", "32 cm"],
        products: [
          "Sartén antiadherente", "Cacerola", "Olla con tapa", "Fuente para horno", "Asadera",
          "Wok antiadherente", "Plancha bifera", "Pizzera", "Molde para torta", "Budinera"
        ]
      },
      {
        variants: ["Chico", "Mediano", "Grande", "Extra grande", "Juego x3"],
        products: [
          "Colador de cocina", "Espátula", "Cucharón", "Cuchara de madera", "Tabla de cortar",
          "Pelapapas", "Rallador", "Abrelatas", "Sacacorchos", "Repasador de cocina"
        ]
      }
    ]
  },
  libreria: {
    name: "Librería",
    groups: [
      {
        variants: ["48 hojas", "84 hojas", "100 hojas", "150 hojas", "200 hojas"],
        products: [
          "Cuaderno tapa flexible rayado", "Cuaderno tapa dura rayado", "Cuaderno cuadriculado",
          "Cuaderno universitario", "Cuaderno espiral", "Anotador liso", "Anotador rayado",
          "Block de notas", "Block de dibujo", "Agenda diaria"
        ]
      },
      {
        variants: ["Azul", "Negro", "Rojo", "Verde", "Violeta"],
        products: [
          "Lapicera azul", "Lapicera gel", "Marcador permanente", "Marcador para pizarra",
          "Resaltador", "Lápiz negro", "Lápiz corrector", "Microfibra", "Fibrón grueso", "Crayón"
        ]
      },
      {
        variants: ["A4", "A3", "Oficio", "Carta", "Legal"],
        products: [
          "Resma papel obra 75 g", "Resma papel obra 90 g", "Papel ilustración", "Cartulina blanca",
          "Cartulina de color", "Papel afiche", "Papel madera", "Papel vegetal", "Papel fotográfico", "Papel autoadhesivo"
        ]
      },
      {
        variants: ["Chico", "Mediano", "Grande", "Pack x6", "Pack x12"],
        products: [
          "Goma de borrar", "Sacapuntas", "Regla escolar", "Tijera escolar", "Adhesivo vinílico",
          "Cinta adhesiva", "Corrector líquido", "Carpeta escolar", "Folios transparentes", "Sobre papel madera"
        ]
      }
    ]
  },
  perfumeria: {
    name: "Perfumería",
    groups: [
      {
        variants: ["30 ml", "50 ml", "75 ml", "100 ml", "200 ml"],
        products: [
          "Perfume femenino floral", "Perfume femenino cítrico", "Perfume femenino dulce",
          "Perfume masculino amaderado", "Perfume masculino fresco", "Colonia infantil",
          "Agua de colonia", "Eau de toilette", "Eau de parfum", "Body splash"
        ]
      },
      {
        variants: ["200 ml", "350 ml", "400 ml", "750 ml", "1 l"],
        products: [
          "Shampoo cabello normal", "Shampoo cabello seco", "Shampoo cabello graso", "Acondicionador",
          "Crema de enjuague", "Jabón líquido", "Gel de ducha", "Crema corporal", "Loción corporal", "Alcohol en gel"
        ]
      },
      {
        variants: ["50 ml", "90 ml", "150 ml", "200 ml", "Pack x2"],
        products: [
          "Desodorante aerosol", "Desodorante roll-on", "Desodorante en barra", "Espuma de afeitar",
          "Crema de afeitar", "Loción para después de afeitar", "Crema facial", "Protector solar",
          "Crema para manos", "Talco corporal"
        ]
      },
      {
        variants: ["Unidad", "Pack x2", "Pack x3", "Pack x6", "Pack familiar"],
        products: [
          "Jabón de tocador", "Pasta dental", "Cepillo dental adulto", "Cepillo dental infantil",
          "Enjuague bucal", "Hilo dental", "Algodón", "Hisopos", "Pañuelos descartables", "Toallitas húmedas"
        ]
      }
    ]
  },
  electronica: {
    name: "Electrónica",
    groups: [
      {
        variants: ["1 m", "1.5 m", "2 m", "3 m", "5 m"],
        products: [
          "Cable USB-A a USB-C", "Cable USB-C a USB-C", "Cable USB-A a Lightning",
          "Cable HDMI", "Cable de red", "Cable auxiliar 3.5 mm", "Cable RCA", "Cable de audio óptico",
          "Cable prolongador", "Cable para impresora"
        ]
      },
      {
        variants: ["5 W", "10 W", "20 W", "25 W", "33 W"],
        products: [
          "Cargador USB-A", "Cargador USB-C", "Cargador rápido USB-C", "Cargador inalámbrico",
          "Cargador para auto", "Fuente para router", "Fuente switching", "Adaptador de corriente",
          "Power bank", "Cargador universal"
        ]
      },
      {
        variants: ["32 GB", "64 GB", "128 GB", "256 GB", "512 GB"],
        products: [
          "Pendrive USB", "Tarjeta microSD", "Tarjeta SD", "Memoria USB-C", "Adaptador USB con memoria",
          "Reproductor multimedia", "Disco sólido externo", "Disco rígido externo", "Grabador de voz", "Lector de tarjetas"
        ]
      },
      {
        variants: ["Negro", "Blanco", "Azul", "Rojo", "Gris"],
        products: [
          "Auricular in-ear", "Auricular vincha", "Auricular inalámbrico", "Parlante portátil",
          "Parlante bluetooth", "Mouse inalámbrico", "Mouse USB", "Teclado USB", "Teclado inalámbrico", "Control remoto universal"
        ]
      }
    ]
  },
  gastronomia: {
    name: "Gastronomía",
    groups: [
      {
        variants: ["500 g", "1 kg", "2 kg", "5 kg", "10 kg"],
        products: [
          "Harina de trigo", "Harina integral", "Azúcar", "Arroz", "Polenta", "Avena",
          "Pan rallado", "Sal fina", "Fideos secos", "Lentejas"
        ]
      },
      {
        variants: ["250 ml", "500 ml", "900 ml", "1.5 l", "2 l"],
        products: [
          "Aceite de girasol", "Aceite de oliva", "Vinagre", "Leche entera", "Crema de leche",
          "Agua mineral", "Gaseosa cola", "Jugo de naranja", "Cerveza rubia", "Vino tinto"
        ]
      },
      {
        variants: ["Unidad", "Porción chica", "Porción mediana", "Porción grande", "Combo"],
        products: [
          "Milanesa de carne", "Milanesa de pollo", "Hamburguesa completa", "Pizza muzzarella",
          "Pizza napolitana", "Empanada de carne", "Empanada de pollo", "Tarta de verdura",
          "Ensalada mixta", "Sándwich de milanesa"
        ]
      },
      {
        variants: ["Unidad", "Media docena", "Docena", "Caja x6", "Caja x12"],
        products: [
          "Medialuna de manteca", "Medialuna de grasa", "Factura rellena", "Chipa",
          "Alfajor de maicena", "Alfajor de chocolate", "Budín casero", "Porción de torta",
          "Pan francés", "Pan de campo"
        ]
      }
    ]
  },
  imprenta: {
    name: "Imprenta, gráfica e impresión digital",
    groups: [
      {
        variants: ["A5 blanco y negro", "A4 blanco y negro", "A4 color", "A3 blanco y negro", "A3 color"],
        products: [
          "Impresión en papel obra 75 g", "Impresión en papel obra 90 g", "Impresión en papel ilustración",
          "Impresión de texto", "Impresión de imagen", "Impresión de plano", "Impresión de presentación",
          "Impresión de formulario", "Impresión de diploma", "Impresión de menú"
        ]
      },
      {
        variants: ["A6", "A5", "A4", "A3", "A3 doble faz"],
        products: [
          "Fotocopia", "Impresión láser", "Impresión inkjet", "Impresión doble faz",
          "Impresión de folleto", "Impresión de catálogo", "Impresión de lista de precios",
          "Impresión de invitación", "Impresión de certificado", "Impresión de etiqueta"
        ]
      },
      {
        variants: ["90 g", "115 g", "150 g", "200 g", "300 g"],
        products: [
          "Papel ilustración", "Papel obra", "Papel fotográfico brillante", "Papel fotográfico mate",
          "Cartulina gráfica", "Papel autoadhesivo", "Papel kraft", "Papel vegetal",
          "Papel reciclado", "Papel para tarjeta"
        ]
      },
      {
        variants: ["Corte recto", "Corte redondo", "Laminado mate", "Laminado brillante", "Troquelado"],
        products: [
          "Tarjeta personal", "Folleto comercial", "Volante promocional", "Afiche publicitario",
          "Etiqueta adhesiva", "Stickers impresos", "Menú plastificado", "Tapa de presentación",
          "Señalador impreso", "Cartel de mostrador"
        ]
      }
    ]
  }
};

const industryTemplates = Object.fromEntries(Object.entries(industryCatalogs).map(([key, catalog]) => {
  const products = catalog.groups.flatMap((group) =>
    group.products.flatMap((product) => group.variants.map((variant) => `${product} · ${variant}`))
  );
  if (products.length < 200 || new Set(products).size !== products.length) {
    throw new Error(`El catálogo de ${catalog.name} debe tener al menos 200 productos únicos.`);
  }
  return [key, { name: catalog.name, products }];
}));

module.exports = { industryTemplates };
