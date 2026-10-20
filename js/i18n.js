(() => {
  const STORAGE = "aa_lang";
  const SUPPORTED = ["en", "fr", "de"];
  const LANG_IDS = {
    "2fbb5fe2e29a4d70aa5854ce7ce3e20b": "en",
    "019a38ae577c7653bb966e47a953d448": "fr",
    "019669a9ec827194b445e0ea88950424": "de",
  };

  const dict = {
    en: {
      brandOrders: "Pièces Auto · Orders via WhatsApp ·",
      categories: "Categories",
      contact: "Contact",
      home: "Home",
      carParts: "Car Parts",
      buy: "Buy",
      added: "Added",
      addToCart: "Add to cart",
      qty: "Qty",
      remove: "Remove",
      total: "Total",
      each: "each",
      cart: "Cart",
      shoppingCart: "Shopping cart",
      cartEmpty: "Your cart is empty",
      cartEmptyHint: "Browse categories and tap Buy to add parts.",
      continueShopping: "Continue shopping",
      viewCart: "View cart",
      product: "Product",
      price: "Price",
      subtotal: "Subtotal",
      orderWhatsApp: "Order on WhatsApp",
      detailsThenWhatsApp: "Enter details then WhatsApp",
      enterDetailsAndOrder: "Enter details and order",
      cartWhatsAppNotice:
        "Orders are placed on WhatsApp at {phone}.",
      checkoutWhatsAppNotice:
        "Send your order on WhatsApp ({phone}). We confirm availability, shipping, and payment in the chat.",
      checkoutTitle: "Order on WhatsApp",
      itemCount: "{n} item(s)",
      fullName: "Full name",
      phoneWhatsApp: "Phone (WhatsApp)",
      addressOptional: "Address (optional)",
      cityOptional: "City (optional)",
      zipOptional: "Postal code (optional)",
      country: "Country",
      orderNote: "Order note",
      orderNotePlaceholder: "Vehicle reference, urgency, etc.",
      seeParts: "Browse parts",
      whatsappOpened: "WhatsApp opened",
      whatsappReady:
        "Your order message is ready. If WhatsApp did not open, use the button below.",
      reopenWhatsApp: "Reopen WhatsApp",
      backToCart: "Back to cart",
      articleNumber: "Article number",
      ean: "EAN",
      brand: "Brand",
      priceVat: "price incl. % VAT, excl. delivery costs",
      pricePerItem: "Price per item",
      priceInclVat: "price incl. 19% VAT",
      exclDeliveryPrefix: "excl.",
      deliveryCosts: "delivery costs",
      onlyNLeft: "Only {n} left in stock",
      inStock: "In stock",
      outOfStock: "Out of stock",
      wishlist: "Wishlist",
      wishlisted: "Wishlisted",
      addWishlist: "Add to wishlist",
      wishlistEmpty: "Your wishlist is empty.",
      search: "Search",
      searchPlaceholder: "Enter search term...",
      searchHint: "Type a keyword to search our catalog.",
      searchResults: "{n} result(s) for “{q}”",
      productsAvailable: "{n} product(s) available",
      noCategoryProducts: "No parts found in this category. Browse other categories or search.",
      noPartsInCategory: "No parts found in this category. Browse other categories or search.",
      noPartsForVehicleCategory:
        "No parts for this vehicle in this category. Try another category or change vehicle.",
      browseAllCategories: "Browse all categories",
      productNotFound: "Product not found",
      productMissing: "This product is currently unavailable.",
      backToCategories: "Back to categories",
      accountLogin: "Account login",
      accountLocal: "Sign in to manage your account preferences on this device.",
      email: "Email",
      password: "Password",
      signIn: "Sign in",
      signOut: "Sign out",
      noAccount: "No account?",
      register: "Register",
      createAccount: "Create account",
      signedInAs: "Signed in as {email}.",
      language: "Language",
      languageSet:
        "Language set to {label}.",
      continueShop: "Continue to shop",
      vehicleParts: "Parts for your vehicle",
      selection: "Selection",
      any: "any",
      vehicleNotice:
        "Showing parts based on your vehicle selection.",
      pageNotFound: "Page not found",
      noLocalRoute: "No local route for",
      contentMissing: "This page is currently unavailable.",
      priceOnRequest: "Price on request",
      close: "Close",
      menu: "Menu",
      closeMenu: "Close menu",
      showAllIn: "Show all in {title}",
      navCategories: "Categories",
      addedToCart: "Added to cart",
      couldNotAdd: "Could not add this product",
      waHello: "Hello, I would like to order from Pièces Auto:",
      waEmpty: "(Empty cart)",
      waTotalLine: "Total: {total} · {n} item(s)",
      waName: "Name",
      waPhone: "Phone",
      waAddress: "Address",
      waNote: "Note",
      waThanks: "Thank you!",
      cookieSettings: "Cookie settings",
      cookieChoose: "Choose which cookies we may use in your browser.",
      cookieRequired: "Technically required (always on)",
      cookieAnalytics: "Analytics (optional)",
      cookieMarketing: "Marketing (optional)",
      savePreferences: "Save preferences",
      cancel: "Cancel",
      cookieOnlyRequired: "Only technically required",
      cookieConfigure: "Configure",
      cookieAcceptAll: "Accept all cookies",
      cookieBody:
        "This website uses cookies to provide the best shopping experience. You can accept all cookies or configure your preferences.",
      customerServiceHours:
        "Customer service: Mon-Fri 08:00-18:00 (CET) | Sat-Sun: closed",
      helpSupport: "HELP & SUPPORT",
      customerService: "CUSTOMER SERVICE",
      topProducts: "TOP PRODUCTS",
      shoppingCartTitle: "Shopping cart",
      changeLanguage: "Change language ({label} is the current language)",
      findParts: "Find parts",
      selectMaker: "Select maker",
      selectModel: "Select model",
      selectEngine: "Select engine",
      vehicleLoading: "Loading…",
      yourVehicle: "Your vehicle",
      changeVehicle: "Change vehicle",
      vehicleFinderHint: "Select your maker, model and engine to see matching parts.",
      findPartsByVehicle: "Find parts by vehicle",
      findPartsBySelectingVehicle: "Find parts by selecting your vehicle",
      searchByVin: "Search for spare parts by VIN number",
      enterVin: "Enter VIN number",
      vinHelpText:
        "The VIN is your vehicle's unique 17-character code, found on the registration certificate or on the car body.",
      whatIsVin: "What is VIN?",
      resetVehicleSelection: "Reset vehicle selection",
      make: "Make",
      modelLabel: "Model",
      engineLabel: "Engine",
      productAddedToCart: "{n} product added to your shopping cart.",
      productsAddedToCart: "{n} products added to your shopping cart.",
      backToFinder: "Back to vehicle finder",
      plateVinHint:
        "Plate and VIN lookup is not available here yet. Select your maker, model and engine on the left, or contact us on WhatsApp.",
      plateVinNeedValue: "Enter a plate or VIN, or use maker / model / engine.",
      vehicleResultsHint: "Compatible parts for your selection. Order on WhatsApp from the cart.",
      vehicleNoFitment: "No vehicle-specific parts are loaded for this engine yet.",
      vehicleBrowseCategoriesHint: "Browse a category below to find parts. Category listings stay specific to each category.",
      vehicleResultsCount: "{n} parts matched for your vehicle.",
      vehicleAlsoBrowse: "Or continue in a category:",
      searchInCategory: "Searching in {cat}",
      searchAllCategories: "Search all categories",
      searchInCategoryPlaceholder: "Search in {cat}…",
      noSearchResults: "No products match this search.",
      spareParts: "Spare parts",
      sparePartsFor: "Spare parts for {vehicle}",
      sparePartsForIntro:
        "Browse {n} part categories for {vehicle}. Original and aftermarket parts from trusted brands. Find filters, brake pads, suspension parts and more for your {fuel} {power} {brand}.",
      vehicleDetails: "Vehicle Details",
      change: "Change",
      catalogTabs: "Catalog sections",
      bestPartsFor: "BEST PARTS FOR {vehicle}",
      ourCatalogFor: "OUR CATALOG OF SPARE PARTS FOR THE {vehicle}",
      expandCategory: "Expand category",
      previous: "Previous",
      next: "Next",
      fuelTypeGeneric: "vehicle",
      close: "Close",
      topCategories: "Top categories",
      allCategories: "All categories",
      categoriesAvailable: "{n} categories",
      sparesHubHint: "{n} spare-part categories · {p} products in the catalog.",
      countryFrance: "France",
      countryBelgium: "Belgium",
      countryGermany: "Germany",
      countryNetherlands: "Netherlands",
      langEnglish: "English",
      langFrench: "French",
      langGerman: "German",
    },
    fr: {
      brandOrders: "Pièces Auto · Commandes via WhatsApp ·",
      categories: "Catégories",
      contact: "Contact",
      home: "Accueil",
      carParts: "Pièces auto",
      buy: "Acheter",
      added: "Ajouté",
      addToCart: "Ajouter au panier",
      qty: "Qté",
      remove: "Retirer",
      total: "Total",
      each: "l’unité",
      cart: "Panier",
      shoppingCart: "Panier",
      cartEmpty: "Votre panier est vide",
      cartEmptyHint: "Parcourez les catégories et appuyez sur Acheter.",
      continueShopping: "Continuer vos achats",
      viewCart: "Voir le panier",
      product: "Produit",
      price: "Prix",
      subtotal: "Sous-total",
      orderWhatsApp: "Commander sur WhatsApp",
      detailsThenWhatsApp: "Coordonnées puis WhatsApp",
      enterDetailsAndOrder: "Saisir les infos et commander",
      cartWhatsAppNotice:
        "Les commandes se passent sur WhatsApp au {phone}.",
      checkoutWhatsAppNotice:
        "Envoyez votre commande sur WhatsApp ({phone}). Disponibilité, livraison et paiement se confirment dans la conversation.",
      checkoutTitle: "Commander sur WhatsApp",
      itemCount: "{n} article(s)",
      fullName: "Nom complet",
      phoneWhatsApp: "Téléphone (WhatsApp)",
      addressOptional: "Adresse (optionnel)",
      cityOptional: "Ville (optionnel)",
      zipOptional: "Code postal (optionnel)",
      country: "Pays",
      orderNote: "Note pour la commande",
      orderNotePlaceholder: "Référence véhicule, urgences, etc.",
      seeParts: "Voir les pièces",
      whatsappOpened: "WhatsApp ouvert",
      whatsappReady:
        "Votre message de commande est prêt. Si WhatsApp ne s’est pas ouvert, utilisez le bouton ci-dessous.",
      reopenWhatsApp: "Rouvrir WhatsApp",
      backToCart: "Retour au panier",
      articleNumber: "Référence",
      ean: "EAN",
      brand: "Marque",
      priceVat: "prix TTC, hors frais de livraison",
      pricePerItem: "Prix par article",
      priceInclVat: "prix TTC 19 %",
      exclDeliveryPrefix: "hors",
      deliveryCosts: "frais de livraison",
      onlyNLeft: "Plus que {n} en stock",
      inStock: "En stock",
      outOfStock: "Rupture de stock",
      wishlist: "Liste de souhaits",
      wishlisted: "Dans la liste",
      addWishlist: "Ajouter à la liste",
      wishlistEmpty: "Votre liste de souhaits est vide.",
      search: "Recherche",
      searchPlaceholder: "Entrez un terme de recherche...",
      searchHint: "Tapez un mot-clé pour chercher dans le catalogue.",
      searchResults: "{n} résultat(s) pour « {q} »",
      productsAvailable: "{n} produit(s) disponibles",
      noCategoryProducts:
        "Aucune pièce trouvée dans cette catégorie. Parcourez d’autres catégories ou recherchez.",
      noPartsInCategory:
        "Aucune pièce trouvée dans cette catégorie. Parcourez d’autres catégories ou recherchez.",
      noPartsForVehicleCategory:
        "Aucune pièce pour ce véhicule dans cette catégorie. Essayez une autre catégorie ou changez de véhicule.",
      browseAllCategories: "Toutes les catégories",
      productNotFound: "Produit introuvable",
      productMissing: "Ce produit n’est pas disponible actuellement.",
      backToCategories: "Retour aux catégories",
      accountLogin: "Connexion compte",
      accountLocal: "Connectez-vous pour gérer vos préférences sur cet appareil.",
      email: "E-mail",
      password: "Mot de passe",
      signIn: "Se connecter",
      signOut: "Se déconnecter",
      noAccount: "Pas de compte ?",
      register: "S’inscrire",
      createAccount: "Créer un compte",
      signedInAs: "Connecté en tant que {email}.",
      language: "Langue",
      languageSet:
        "Langue définie sur {label}.",
      continueShop: "Continuer vers la boutique",
      vehicleParts: "Pièces pour votre véhicule",
      selection: "Sélection",
      any: "tous",
      vehicleNotice:
        "Pièces affichées selon votre sélection de véhicule.",
      pageNotFound: "Page introuvable",
      noLocalRoute: "Aucune route locale pour",
      contentMissing: "Cette page n’est pas disponible actuellement.",
      priceOnRequest: "Prix sur demande",
      close: "Fermer",
      menu: "Menu",
      closeMenu: "Fermer le menu",
      showAllIn: "Tout afficher dans {title}",
      navCategories: "Catégories",
      addedToCart: "Ajouté au panier",
      couldNotAdd: "Impossible d’ajouter ce produit",
      waHello: "Bonjour, je souhaite commander sur Pièces Auto:",
      waEmpty: "(Panier vide)",
      waTotalLine: "Total: {total} · {n} article(s)",
      waName: "Nom",
      waPhone: "Téléphone",
      waAddress: "Adresse",
      waNote: "Note",
      waThanks: "Merci !",
      cookieSettings: "Paramètres des cookies",
      cookieChoose: "Choisissez les cookies que nous pouvons utiliser.",
      cookieRequired: "Techniquement nécessaires (toujours actifs)",
      cookieAnalytics: "Analytique (optionnel)",
      cookieMarketing: "Marketing (optionnel)",
      savePreferences: "Enregistrer",
      cancel: "Annuler",
      cookieOnlyRequired: "Uniquement nécessaires",
      cookieConfigure: "Configurer",
      cookieAcceptAll: "Tout accepter",
      cookieBody:
        "Ce site utilise des cookies pour offrir la meilleure expérience d’achat. Vous pouvez tout accepter ou configurer vos préférences.",
      customerServiceHours:
        "Service client : Lun-Ven 08:00-18:00 (CET) | Sam-Dim : fermé",
      helpSupport: "AIDE & SUPPORT",
      customerService: "SERVICE CLIENT",
      topProducts: "TOP PRODUITS",
      shoppingCartTitle: "Panier",
      changeLanguage: "Changer de langue ({label} est la langue actuelle)",
      findParts: "Trouver des pièces",
      selectMaker: "Choisir la marque",
      selectModel: "Choisir le modèle",
      selectEngine: "Choisir le moteur",
      vehicleLoading: "Chargement…",
      yourVehicle: "Votre véhicule",
      changeVehicle: "Changer de véhicule",
      vehicleFinderHint: "Choisissez marque, modèle et moteur pour voir les pièces compatibles.",
      findPartsByVehicle: "Trouver des pièces par véhicule",
      findPartsBySelectingVehicle: "Trouver des pièces en sélectionnant votre véhicule",
      searchByVin: "Rechercher des pièces détachées par numéro VIN",
      enterVin: "Saisir le numéro VIN",
      vinHelpText:
        "Le VIN est le code unique de 17 caractères de votre véhicule, figurant sur la carte grise ou sur la carrosserie.",
      whatIsVin: "Qu’est-ce que le VIN ?",
      resetVehicleSelection: "Réinitialiser la sélection",
      make: "Marque",
      modelLabel: "Modèle",
      engineLabel: "Moteur",
      productAddedToCart: "{n} produit ajouté à votre panier.",
      productsAddedToCart: "{n} produits ajoutés à votre panier.",
      backToFinder: "Retour au sélecteur",
      plateVinHint:
        "La recherche par plaque ou VIN n’est pas encore disponible ici. Choisissez marque, modèle et moteur à gauche, ou contactez-nous sur WhatsApp.",
      plateVinNeedValue: "Saisissez une plaque ou un VIN, ou utilisez marque / modèle / moteur.",
      vehicleResultsHint:
        "Pièces compatibles avec votre sélection. Commandez sur WhatsApp depuis le panier.",
      vehicleNoFitment: "Aucune pièce spécifique à ce moteur n'est encore chargée.",
      vehicleBrowseCategoriesHint: "Choisissez une catégorie ci-dessous. Chaque catégorie affiche ses propres pièces.",
      vehicleResultsCount: "{n} pièces correspondant à votre véhicule.",
      vehicleAlsoBrowse: "Ou continuez dans une catégorie :",
      searchInCategory: "Recherche dans {cat}",
      searchAllCategories: "Rechercher dans toutes les catégories",
      searchInCategoryPlaceholder: "Rechercher dans {cat}…",
      noSearchResults: "Aucun produit ne correspond à cette recherche.",
      spareParts: "Pièces détachées",
      sparePartsFor: "Pièces détachées pour {vehicle}",
      sparePartsForIntro:
        "Parcourez {n} catégories de pièces pour {vehicle}. Pièces d’origine et adaptables de marques de confiance. Trouvez filtres, plaquettes, suspension et plus pour votre {fuel} {power} {brand}.",
      vehicleDetails: "Détails du véhicule",
      change: "Changer",
      catalogTabs: "Sections du catalogue",
      bestPartsFor: "MEILLEURES PIÈCES POUR {vehicle}",
      ourCatalogFor: "NOTRE CATALOGUE DE PIÈCES POUR {vehicle}",
      expandCategory: "Développer la catégorie",
      previous: "Précédent",
      next: "Suivant",
      fuelTypeGeneric: "véhicule",
      close: "Fermer",
      topCategories: "Catégories principales",
      allCategories: "Toutes les catégories",
      categoriesAvailable: "{n} catégories",
      sparesHubHint: "{n} catégories de pièces · {p} produits dans le catalogue.",
      countryFrance: "France",
      countryBelgium: "Belgique",
      countryGermany: "Allemagne",
      countryNetherlands: "Pays-Bas",
      langEnglish: "English",
      langFrench: "Français",
      langGerman: "Deutsch",
    },
    de: {
      brandOrders: "Pièces Auto · Bestellungen über WhatsApp ·",
      categories: "Kategorien",
      contact: "Kontakt",
      home: "Startseite",
      carParts: "Autoteile",
      buy: "Kaufen",
      added: "Hinzugefügt",
      addToCart: "In den Warenkorb",
      qty: "Menge",
      remove: "Entfernen",
      total: "Summe",
      each: "je",
      cart: "Warenkorb",
      shoppingCart: "Warenkorb",
      cartEmpty: "Ihr Warenkorb ist leer",
      cartEmptyHint: "Kategorien durchsuchen und auf Kaufen tippen.",
      continueShopping: "Weiter einkaufen",
      viewCart: "Warenkorb ansehen",
      product: "Produkt",
      price: "Preis",
      subtotal: "Zwischensumme",
      orderWhatsApp: "Per WhatsApp bestellen",
      detailsThenWhatsApp: "Daten eingeben, dann WhatsApp",
      enterDetailsAndOrder: "Daten eingeben und bestellen",
      cartWhatsAppNotice:
        "Bestellungen laufen über WhatsApp unter {phone}.",
      checkoutWhatsAppNotice:
        "Senden Sie Ihre Bestellung über WhatsApp ({phone}). Verfügbarkeit, Versand und Zahlung klären wir im Chat.",
      checkoutTitle: "Per WhatsApp bestellen",
      itemCount: "{n} Artikel",
      fullName: "Vollständiger Name",
      phoneWhatsApp: "Telefon (WhatsApp)",
      addressOptional: "Adresse (optional)",
      cityOptional: "Stadt (optional)",
      zipOptional: "PLZ (optional)",
      country: "Land",
      orderNote: "Bestellnotiz",
      orderNotePlaceholder: "Fahrzeugreferenz, Dringlichkeit usw.",
      seeParts: "Teile ansehen",
      whatsappOpened: "WhatsApp geöffnet",
      whatsappReady:
        "Ihre Bestellnachricht ist bereit. Falls WhatsApp nicht geöffnet wurde, nutzen Sie den Button unten.",
      reopenWhatsApp: "WhatsApp erneut öffnen",
      backToCart: "Zurück zum Warenkorb",
      articleNumber: "Artikelnummer",
      ean: "EAN",
      brand: "Marke",
      priceVat: "Preis inkl. MwSt., zzgl. Versand",
      pricePerItem: "Preis pro Stück",
      priceInclVat: "Preis inkl. 19 % MwSt.",
      exclDeliveryPrefix: "zzgl.",
      deliveryCosts: "Versandkosten",
      onlyNLeft: "Nur noch {n} auf Lager",
      inStock: "Auf Lager",
      outOfStock: "Nicht auf Lager",
      wishlist: "Merkzettel",
      wishlisted: "Gemerkt",
      addWishlist: "Auf den Merkzettel",
      wishlistEmpty: "Ihr Merkzettel ist leer.",
      search: "Suche",
      searchPlaceholder: "Suchbegriff eingeben...",
      searchHint: "Geben Sie ein Stichwort ein, um den Katalog zu durchsuchen.",
      searchResults: "{n} Ergebnis(se) für „{q}“",
      productsAvailable: "{n} Produkt(e) verfügbar",
      noCategoryProducts:
        "Keine Teile in dieser Kategorie gefunden. Andere Kategorien oder die Suche nutzen.",
      noPartsInCategory:
        "Keine Teile in dieser Kategorie gefunden. Andere Kategorien oder die Suche nutzen.",
      noPartsForVehicleCategory:
        "Für dieses Fahrzeug gibt es in dieser Kategorie keine Teile. Andere Kategorie wählen oder Fahrzeug wechseln.",
      browseAllCategories: "Alle Kategorien",
      productNotFound: "Produkt nicht gefunden",
      productMissing: "Dieses Produkt ist derzeit nicht verfügbar.",
      backToCategories: "Zurück zu den Kategorien",
      accountLogin: "Konto anmelden",
      accountLocal: "Melden Sie sich an, um Einstellungen auf diesem Gerät zu verwalten.",
      email: "E-Mail",
      password: "Passwort",
      signIn: "Anmelden",
      signOut: "Abmelden",
      noAccount: "Kein Konto?",
      register: "Registrieren",
      createAccount: "Konto erstellen",
      signedInAs: "Angemeldet als {email}.",
      language: "Sprache",
      languageSet:
        "Sprache auf {label} gesetzt.",
      continueShop: "Zum Shop",
      vehicleParts: "Teile für Ihr Fahrzeug",
      selection: "Auswahl",
      any: "beliebig",
      vehicleNotice:
        "Teile werden anhand Ihrer Fahrzeugauswahl angezeigt.",
      pageNotFound: "Seite nicht gefunden",
      noLocalRoute: "Keine lokale Route für",
      contentMissing: "Diese Seite ist derzeit nicht verfügbar.",
      priceOnRequest: "Preis auf Anfrage",
      close: "Schließen",
      menu: "Menü",
      closeMenu: "Menü schließen",
      showAllIn: "Alle in {title} anzeigen",
      navCategories: "Kategorien",
      addedToCart: "Zum Warenkorb hinzugefügt",
      couldNotAdd: "Produkt konnte nicht hinzugefügt werden",
      waHello: "Hallo, ich möchte bei Pièces Auto bestellen:",
      waEmpty: "(Leerer Warenkorb)",
      waTotalLine: "Summe: {total} · {n} Artikel",
      waName: "Name",
      waPhone: "Telefon",
      waAddress: "Adresse",
      waNote: "Notiz",
      waThanks: "Danke!",
      cookieSettings: "Cookie-Einstellungen",
      cookieChoose: "Wählen Sie, welche Cookies wir nutzen dürfen.",
      cookieRequired: "Technisch erforderlich (immer an)",
      cookieAnalytics: "Analyse (optional)",
      cookieMarketing: "Marketing (optional)",
      savePreferences: "Einstellungen speichern",
      cancel: "Abbrechen",
      cookieOnlyRequired: "Nur technisch erforderliche",
      cookieConfigure: "Konfigurieren",
      cookieAcceptAll: "Alle Cookies akzeptieren",
      cookieBody:
        "Diese Website verwendet Cookies für das beste Einkaufserlebnis. Sie können alle akzeptieren oder Einstellungen wählen.",
      customerServiceHours:
        "Kundenservice: Mo-Fr 08:00-18:00 (CET) | Sa-So: geschlossen",
      helpSupport: "HILFE & SUPPORT",
      customerService: "KUNDENSERVICE",
      topProducts: "TOP-PRODUKTE",
      shoppingCartTitle: "Warenkorb",
      changeLanguage: "Sprache ändern ({label} ist die aktuelle Sprache)",
      findParts: "Teile finden",
      selectMaker: "Marke wählen",
      selectModel: "Modell wählen",
      selectEngine: "Motor wählen",
      vehicleLoading: "Wird geladen…",
      yourVehicle: "Ihr Fahrzeug",
      changeVehicle: "Fahrzeug ändern",
      vehicleFinderHint: "Wählen Sie Marke, Modell und Motor, um passende Teile zu sehen.",
      findPartsByVehicle: "Teile nach Fahrzeug finden",
      findPartsBySelectingVehicle: "Teile finden durch Fahrzeugauswahl",
      searchByVin: "Ersatzteile per VIN-Nummer suchen",
      enterVin: "VIN-Nummer eingeben",
      vinHelpText:
        "Die VIN ist der eindeutige 17-stellige Code Ihres Fahrzeugs, zu finden im Fahrzeugschein oder an der Karosserie.",
      whatIsVin: "Was ist die VIN?",
      resetVehicleSelection: "Auswahl zurücksetzen",
      make: "Marke",
      modelLabel: "Modell",
      engineLabel: "Motor",
      productAddedToCart: "{n} Produkt wurde Ihrem Warenkorb hinzugefügt.",
      productsAddedToCart: "{n} Produkte wurden Ihrem Warenkorb hinzugefügt.",
      backToFinder: "Zurück zur Fahrzeugsuche",
      plateVinHint:
        "Kennzeichen- und VIN-Suche ist hier noch nicht verfügbar. Wählen Sie links Marke, Modell und Motor, oder kontaktieren Sie uns per WhatsApp.",
      plateVinNeedValue: "Kennzeichen oder VIN eingeben, oder Marke / Modell / Motor nutzen.",
      vehicleResultsHint:
        "Passende Teile für Ihre Auswahl. Bestellen Sie per WhatsApp aus dem Warenkorb.",
      vehicleNoFitment: "Für diesen Motor sind noch keine fahrzeugspezifischen Teile geladen.",
      vehicleBrowseCategoriesHint: "Wählen Sie unten eine Kategorie. Jede Kategorie zeigt eigene Teile.",
      vehicleResultsCount: "{n} Teile für Ihr Fahrzeug.",
      vehicleAlsoBrowse: "Oder in einer Kategorie weiter:",
      searchInCategory: "Suche in {cat}",
      searchAllCategories: "Alle Kategorien durchsuchen",
      searchInCategoryPlaceholder: "In {cat} suchen…",
      noSearchResults: "Keine Produkte für diese Suche.",
      spareParts: "Ersatzteile",
      sparePartsFor: "Ersatzteile für {vehicle}",
      sparePartsForIntro:
        "Durchsuchen Sie {n} Teilekategorien für {vehicle}. Original- und Aftermarket-Teile vertrauenswürdiger Marken. Finden Sie Filter, Bremsbeläge, Fahrwerk und mehr für Ihr {fuel} {power} {brand}.",
      vehicleDetails: "Fahrzeugdetails",
      change: "Ändern",
      catalogTabs: "Katalogbereiche",
      bestPartsFor: "BESTE TEILE FÜR {vehicle}",
      ourCatalogFor: "UNSER ERSATZTEILKATALOG FÜR {vehicle}",
      expandCategory: "Kategorie erweitern",
      previous: "Zurück",
      next: "Weiter",
      fuelTypeGeneric: "Fahrzeug",
      close: "Schließen",
      topCategories: "Top-Kategorien",
      allCategories: "Alle Kategorien",
      categoriesAvailable: "{n} Kategorien",
      sparesHubHint: "{n} Ersatzteil-Kategorien · {p} Produkte im Katalog.",
      countryFrance: "Frankreich",
      countryBelgium: "Belgien",
      countryGermany: "Deutschland",
      countryNetherlands: "Niederlande",
      langEnglish: "English",
      langFrench: "Français",
      langGerman: "Deutsch",
    },
  };

  let current = "en";

  function normalize(code) {
    const c = String(code || "")
      .toLowerCase()
      .slice(0, 2);
    return SUPPORTED.includes(c) ? c : null;
  }

  function detectBrowserLang() {
    const list = [];
    if (Array.isArray(navigator.languages)) list.push(...navigator.languages);
    if (navigator.language) list.push(navigator.language);
    for (const item of list) {
      const hit = normalize(item);
      if (hit) return hit;
    }
    return "en";
  }

  function getLang() {
    return current;
  }

  function t(key, vars = {}) {
    const table = dict[current] || dict.en;
    let s = table[key] ?? dict.en[key] ?? key;
    Object.keys(vars).forEach((k) => {
      s = s.replace(new RegExp("\\{" + k + "\\}", "g"), String(vars[k]));
    });
    return s;
  }

  function langLabel(code) {
    if (code === "fr") return t("langFrench");
    if (code === "de") return t("langGerman");
    return t("langEnglish");
  }

  function setDocumentLang(code) {
    document.documentElement.lang = code;
    document.documentElement.setAttribute("data-aa-lang", code);
    document.body?.setAttribute("data-aa-lang", code);
  }

  function updateLanguageForms(code) {
    document.querySelectorAll("form.language-form").forEach((form) => {
      const toggle = form.querySelector(".dropdown-toggle");
      if (toggle) {
        const flag = toggle.querySelector(".language-flag");
        if (flag) {
          flag.className =
            "top-bar-list-icon language-flag " +
            (code === "fr" ? "country-fr language-fr" : code === "de" ? "country-de language-de" : "country-gb language-en");
        }
        const text = toggle.querySelector(".top-bar-nav-text");
        if (text) text.textContent = langLabel(code);
        toggle.setAttribute("aria-label", t("changeLanguage", { label: langLabel(code) }));
      }
      form.querySelectorAll("button[name='languageId']").forEach((btn) => {
        const btnLang = LANG_IDS[btn.value] || null;
        const li = btn.closest("li");
        if (btnLang === code) {
          btn.classList.add("active");
          li?.classList.add("active");
        } else {
          btn.classList.remove("active");
          li?.classList.remove("active");
        }
      });
    });
  }

  function setText(sel, text) {
    document.querySelectorAll(sel).forEach((el) => {
      if (el.children.length && el.querySelector("a,button,input,svg,img")) return;
      el.textContent = text;
    });
  }

  function applyCookieBanner() {
    const banner = document.querySelector(".cookie-permission-container");
    if (!banner) return;
    const body = banner.querySelector(".cookie-permission-content p, .cookie-permission-content .cookie-permission-text, .js-cookie-permission-content");
    const paragraphs = banner.querySelectorAll(".cookie-permission-content p, .cookie-permission-content span.cookie-permission-text");
    if (paragraphs.length) {
      // Prefer first substantial text node block
      const p = [...paragraphs].find((el) => (el.textContent || "").trim().length > 40) || paragraphs[0];
      if (p && !p.querySelector("button")) p.textContent = t("cookieBody");
    } else if (body && !body.querySelector("button")) {
      body.textContent = t("cookieBody");
    }
    const necessary = banner.querySelector(".js-cookie-permission-button button");
    const configure = banner.querySelector(".js-cookie-configuration-button button");
    const acceptAll = banner.querySelector(".js-cookie-accept-all-button button");
    if (necessary) necessary.textContent = t("cookieOnlyRequired");
    if (configure) configure.textContent = t("cookieConfigure");
    if (acceptAll) acceptAll.textContent = t("cookieAcceptAll");

    const panel = document.getElementById("aa-cookie-config");
    if (panel) {
      const h2 = panel.querySelector("h2");
      const p = panel.querySelector("p");
      if (h2) h2.textContent = t("cookieSettings");
      if (p) p.textContent = t("cookieChoose");
      const labels = panel.querySelectorAll("label");
      if (labels[0]) labels[0].lastChild && (labels[0].normalize(), (labels[0].childNodes[labels[0].childNodes.length - 1].textContent = " " + t("cookieRequired")));
      // Safer rebuild of label texts
      const inputs = panel.querySelectorAll("label");
      if (inputs[0]) inputs[0].innerHTML = `<input type="checkbox" checked disabled> ${t("cookieRequired")}`;
      if (inputs[1]) inputs[1].innerHTML = `<input type="checkbox" id="aa-cookie-analytics"> ${t("cookieAnalytics")}`;
      if (inputs[2]) inputs[2].innerHTML = `<input type="checkbox" id="aa-cookie-marketing"> ${t("cookieMarketing")}`;
      const save = panel.querySelector("[data-aa-cookie-save]");
      const cancel = panel.querySelector("[data-aa-cookie-cancel]");
      if (save) save.textContent = t("savePreferences");
      if (cancel) cancel.textContent = t("cancel");
      const card = panel.querySelector("[aria-label]");
      if (card) card.setAttribute("aria-label", t("cookieSettings"));
    }
  }

  function applyShell() {
    setDocumentLang(current);
    updateLanguageForms(current);

    const banner =
      document.getElementById("aa-top-banner") || document.getElementById("aa-sim-banner");
    if (banner) {
      banner.id = "aa-top-banner";
      banner.className = "aa-top-banner";
      banner.innerHTML = `${t("brandOrders")} <a href="/car-parts">${t("categories")}</a> · <a href="/contact-us">${t("contact")}</a>`;
    }

    document.querySelectorAll(".header-cart-btn").forEach((btn) => {
      btn.setAttribute("title", t("shoppingCartTitle"));
    });
    document.querySelectorAll("#cart-widget-aria-label, .header-cart-btn [id*='cart']").forEach((el) => {
      if (el.id === "cart-widget-aria-label" || /cart/i.test(el.id)) el.textContent = t("shoppingCartTitle");
    });

    // Footer hours: only update marked leaf nodes (never parent wrappers)
    document.querySelectorAll("[data-aa-footer-hours]").forEach((el) => {
      el.textContent = t("customerServiceHours");
    });

    // Footer accordion titles (exact text replace when matched)
    document.querySelectorAll("footer, .footer, .footer-main, .footer-bottom").forEach((foot) => {
      foot.querySelectorAll("a, span, button, summary, h2, h3, p, div").forEach((el) => {
        if (el.children.length > 0) return;
        if (el.hasAttribute("data-aa-footer-hours")) return;
        const raw = (el.textContent || "").trim();
        const map = {
          "HELP & SUPPORT": t("helpSupport"),
          "AIDE & SUPPORT": t("helpSupport"),
          "HILFE & SUPPORT": t("helpSupport"),
          "CUSTOMER SERVICE": t("customerService"),
          "SERVICE CLIENT": t("customerService"),
          "KUNDENSERVICE": t("customerService"),
          "TOP PRODUCTS": t("topProducts"),
          "TOP PRODUITS": t("topProducts"),
          "TOP-PRODUKTE": t("topProducts"),
        };
        if (map[raw]) el.textContent = map[raw];
      });
    });

    // Vehicle finder CTA / placeholders when present
    document.querySelectorAll(".find-parts__actions .btn, .find-parts button[type='submit'], button.find-parts-btn").forEach((btn) => {
      if (/find parts|trouver|teile finden|chercher/i.test(btn.textContent || "")) {
        btn.textContent = t("findParts");
      }
    });

    applyCookieBanner();

    // Hide native Shopware language suggest bars; we handle locale ourselves
    document.querySelectorAll(".js-aateile-lang-suggest, .aateile-lang-suggest").forEach((el) => {
      el.hidden = true;
      el.style.display = "none";
    });
  }

  function wireLanguageForms() {
    document.querySelectorAll("form.language-form").forEach((form) => {
      if (form.dataset.aaI18nWired === "1") return;
      form.dataset.aaI18nWired = "1";
      form.addEventListener(
        "submit",
        (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
        },
        true
      );
      form.querySelectorAll("button[name='languageId']").forEach((btn) => {
        btn.addEventListener(
          "click",
          (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            const code = LANG_IDS[btn.value] || "en";
            setLang(code, { reload: true });
          },
          true
        );
      });
    });
  }

  function setLang(code, { reload = false } = {}) {
    const next = normalize(code) || "en";
    current = next;
    try {
      localStorage.setItem(STORAGE, next);
    } catch {}
    applyShell();
    wireLanguageForms();
    window.dispatchEvent(new CustomEvent("aa:lang-changed", { detail: { lang: next } }));
    if (reload) {
      // Stay on same path; locale is storage-driven (not /fr URL dependent)
      const path = location.pathname;
      if (path === "/fr" || path === "/fr/" || path === "/de" || path === "/de/") {
        location.href = "/";
      } else {
        location.reload();
      }
    }
  }

  function boot() {
    let stored = null;
    try {
      stored = normalize(localStorage.getItem(STORAGE));
    } catch {}
    if (stored) {
      current = stored;
    } else {
      current = detectBrowserLang();
      try {
        localStorage.setItem(STORAGE, current);
      } catch {}
    }
    // Path-based hints on first paint if user navigated to /fr or /de without storage yet
    const path = location.pathname.replace(/\/+$/, "") || "/";
    if (!stored && (path === "/fr" || path === "/de")) {
      current = path.slice(1);
      try {
        localStorage.setItem(STORAGE, current);
      } catch {}
    }

    setDocumentLang(current);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        applyShell();
        wireLanguageForms();
      });
    } else {
      applyShell();
      wireLanguageForms();
    }
    // Re-apply after Shopware plugins mutate DOM
    [300, 1000, 2500].forEach((ms) =>
      setTimeout(() => {
        applyShell();
        wireLanguageForms();
      }, ms)
    );
  }

  window.__AA_I18N__ = {
    t,
    getLang,
    setLang,
    detectBrowserLang,
    supported: SUPPORTED.slice(),
    applyShell,
  };

  boot();
})();
