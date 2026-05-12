// Market selector — optional input on every generation route. When picked,
// it injects a strong localization instruction telling Claude to switch
// language, currency, cultural framing for the target market. When NOT
// picked, Claude defaults to the US-market directive from GENERATION_RULES
// (lib/anthropic.ts) and current behavior is preserved.
//
// IMPORTANT: a picked market OVERRIDES the "US market only" line in
// GENERATION_RULES. The aggressive direct-response approach (hard claims,
// FOMO, proof density, zero hedging) stays — we localize the punch, we
// don't soften it. Some markets (France, Germany) have a calibrated tone
// note because hyperbole reads as scam there, but the DR fundamentals
// (problem amplification, mechanism, offer, urgency) still apply.

export const MARKETS = [
  'US',
  'UK',
  'CANADA',
  'AUSTRALIA',
  'FRANCE',
  'GERMANY',
  'ITALY',
  'SPAIN',
  'US_HISPANIC',
] as const;

export type Market = (typeof MARKETS)[number];

export interface MarketMeta {
  value: Market;
  label: string;
  /** Short subtitle for the dropdown (language + currency). */
  hint: string;
}

export const MARKET_OPTIONS: MarketMeta[] = [
  { value: 'US', label: 'United States', hint: 'English · $ USD' },
  { value: 'UK', label: 'United Kingdom', hint: 'English UK · £ GBP' },
  { value: 'CANADA', label: 'Canada', hint: 'English CA · $ CAD' },
  { value: 'AUSTRALIA', label: 'Australia', hint: 'English AU · $ AUD' },
  { value: 'FRANCE', label: 'France', hint: 'Français · € EUR' },
  { value: 'GERMANY', label: 'Germany', hint: 'Deutsch · € EUR' },
  { value: 'ITALY', label: 'Italy', hint: 'Italiano · € EUR' },
  { value: 'SPAIN', label: 'Spain', hint: 'Español · € EUR' },
  { value: 'US_HISPANIC', label: 'US Hispanic', hint: 'Español (US) · $ USD' },
];

export function isMarket(value: unknown): value is Market {
  return typeof value === 'string' && (MARKETS as readonly string[]).includes(value);
}

/**
 * Build the market-localization instruction block for the prompt. Returns
 * an empty string when no market is selected (default — Claude follows
 * the US-market directive from GENERATION_RULES, current behavior).
 *
 * IMPORTANT: this block belongs in the VARIABLE suffix of the prompt (not
 * the cached prefix), because the user may switch market between
 * generations.
 */
export function buildMarketInstruction(market: Market | null | undefined): string {
  if (!market || !isMarket(market)) return '';
  // US is the default — picking it explicitly is a no-op vs the baseline
  // GENERATION_RULES directive. Returning '' keeps the prompt clean.
  if (market === 'US') return '';

  const HEADER = `MARKET LOCALIZATION — OVERRIDES THE DEFAULT US-MARKET DIRECTIVE:
- The "US market only" line in GENERATION RULES is OVERRIDDEN for this output. Language, currency, cultural references all follow the market block below.
- BUT: the aggressive direct-response approach (problem amplification, hard claims where legal, FOMO, proof density, zero hedging) STAYS. We localize the punch, we do NOT soften it. The market-specific TONE notes below tell you how to calibrate the punch — read them carefully, especially for FR / DE where pure US-style hyperbole reads as scam.
- Currency format: use the LOCAL currency in the LOCAL format (see block). Never mix currencies. If the brand's offer is in USD and the market is EU, convert and round (29 USD → 29 €, 49.99 → 49,99 €). Pick a clean round-equivalent over a literal conversion.
- All output (copy, hooks, captions, scripts, image-prompt OVERLAY TEXT) is in the market language. Image-prompt SCENE DESCRIPTION (lighting, composition, materials) stays in English — kie.ai models are English-trained. Only the on-image text overlays are localized.

`;

  const blocks: Record<Exclude<Market, 'US'>, string> = {
    UK: `MARKET: United Kingdom (English UK, £ GBP)
- LANGUAGE: British English. Spelling: "colour", "realise", "centre", "favourite", "behaviour". Vocabulary: "trousers" not "pants", "lift" not "elevator", "queue" not "line", "shop" not "store" (mostly), "advert" / "ad" both fine, "trolley" not "cart" for ecom UI.
- CURRENCY: Pounds sterling. Format: "£29", "£29.99", "£1,299" (comma thousands, dot decimals). Never $.
- TONE: Direct but slightly more reserved than US — the British scam reflex is sharp. Avoid "AMAZING!!!", "INSANE results", "literally life-changing" — they trigger eyeroll. Prefer dry confidence, understated superlatives, "actually works", "finally something that does what it says". British humour (self-deprecating, deadpan) is welcome and converts well.
- CULTURAL: Mention weather only if relevant (it's a stereotype but it does sell — winter coats, SAD lamps, etc.). NHS reference OK for health-adjacent. "High street" = main shopping street. "On the telly" / "in the papers" for media social proof. No "y'all", no "awesome", no "totally".
- DO: dry direct claims, specific stats, before/after photos, customer reviews with British names, Trustpilot-style proof.
- DO NOT: American slang, dollar prices, US-centric holidays (Thanksgiving, 4th of July), "vacation" (use "holiday"), "cell phone" (use "mobile").`,

    CANADA: `MARKET: Canada (English Canadian, $ CAD)
- LANGUAGE: Canadian English — a hybrid of US and British. Use US spelling generally ("color", "realize") but accept "centre" / "metre". Vocabulary leans US ("apartment", "elevator", "trash"). Watch for: "toque" (winter hat), "double-double" (coffee), "loonie / toonie" (1$ / 2$ coin) — these land hard if relevant.
- CURRENCY: Canadian dollars. Format: "$29" or "$29 CAD" when ambiguity matters (especially on Meta — US buyers see your ad too). Prefer "$29 CAD" on offer chips to remove confusion.
- TONE: Slightly warmer and more polite than US. Less hyperbolic than US, less reserved than UK. "Honestly the best [thing] I've tried" works. Hard claims fine, but back them with proof — Canadians are price-conscious and skeptical of empty hype.
- CULTURAL: Winter is a real and constant theme (8 months in much of the country). Tim Hortons, hockey, "eh" (don't force it). Bilingual product names OK if the brand has both. Reference provinces / cities (Toronto, Vancouver, Montreal, Calgary) for relatability. Free shipping across Canada is a huge selling point — call it out.
- DO: friendly direct copy, specific Canadian social proof ("12,000 Canadians switched"), CAD pricing explicit, winter use-cases.
- DO NOT: British spelling exclusively, US-only references (Walmart Black Friday framing — they have it but tone it down), assume cold = bad (Canadians lean in).`,

    AUSTRALIA: `MARKET: Australia (English AU, $ AUD)
- LANGUAGE: Australian English. Spelling: closer to British ("colour", "realise"). Vocabulary: "arvo" (afternoon), "no worries", "heaps" (= a lot), "fair dinkum" (genuine — use sparingly, sounds tryhard), "mate", "brekkie", "thongs" (flip-flops — careful), "Macca's" (McDonald's). Don't pile on slang — 1-2 markers per ad is enough.
- CURRENCY: Australian dollars. Format: "$29" or "$29 AUD" if export-confusion risk. Prefer "$29 AUD" on offer chips for clarity.
- TONE: Very direct, casual, anti-pretentious. Aussies sniff out bullshit fast. Self-deprecation lands. Hyperbole tolerated more than UK but less than US — keep claims specific and provable. Humour wins.
- CULTURAL: Summer is December-February. Sun protection, beach, BBQ, outdoor lifestyle. AusPost shipping callouts. "Aussie-owned" / "made in Australia" is a strong proof point. Heat / drought / bush life shape product framing. Reference Bunnings, Coles, Woolies for relatability.
- DO: casual mate-to-mate tone, specific Aussie social proof, summer/beach framing, AUD prices explicit.
- DO NOT: US winter framing in Australian summer (December = beach, not snow), British formality, fake-Aussie slang stacked 3-deep.`,

    FRANCE: `MARKET: France (français, € EUR)
- LANGUE: 100% français. Pas d'anglais sauf nom de marque et termes techniques sans équivalent ("workout", "smoothie" passent, "amazing" non). Tutoiement par défaut sur le DTC moderne (Meta cold), vouvoiement uniquement pour les marques premium / luxe / B2B. Le tutoiement gagne en CTR sur cold trafic.
- DEVISE: Euros. Format: "29 €" / "29,90 €" / "1 299 €" — espace insécable avant le €, virgule comme séparateur décimal, espace fine comme séparateur de milliers. Jamais $.
- TON: Le marché français a un réflexe "trop beau pour être vrai" anormalement fort. La copy US littéralement traduite ("ÉLIMINEZ vos douleurs INSTANTANÉMENT!!!") s'auto-disqualifie en 1 seconde — ça pue le dropshipping. Garde la pression DR (problème amplifié, urgence, preuve) mais en français ça doit sonner crédible : phrases courtes, preuve concrète, témoignages précis, mécanisme expliqué en mots simples, ZÉRO majuscules hurlées, zéro point d'exclamation triple, zéro "GARANTIE 100%". L'humour pince-sans-rire et la franchise (parfois cassante) convertissent mieux que l'enthousiasme américain.
- CULTURE: Références : pharmacie / parapharmacie (autorité santé énorme), médecin / dermatologue cité, "60 Millions de consommateurs" / "Que Choisir" pour la preuve produit, "Made in France" / fabrication française = argument de poids. La Sécu, l'ANSES, le médecin traitant sont des références fortes. Pas de "Black Friday" pur — préfère "Soldes", "French Days", "Promo de rentrée". Le 1er janvier est moins fort que la rentrée (septembre).
- DO: phrases courtes et directes, preuve concrète et spécifique, témoignages avec prénoms français, ton honnête et un peu cassant, "Made in France" si vrai, livraison France offerte mise en avant.
- DO NOT: traduction littérale du US (90% de la copy française foirée vient de là), majuscules hurlées, hyperbole non sourcée, "AMAZING" rebadgé "INCROYABLE", anglicismes gratuits, prix en $.`,

    GERMANY: `MARKET: Germany (Deutsch, € EUR)
- SPRACHE: 100% Deutsch. Englische Markennamen OK, sonst Deutsch. Anrede: "du" auf DTC / Meta cold (millennials + younger), "Sie" für premium / B2B / health-medical. Default = "du" für die meisten DTC Brands.
- WÄHRUNG: Euro. Format: "29 €" / "29,99 €" / "1.299 €" — Komma als Dezimaltrennzeichen, Punkt als Tausendertrennzeichen, Leerzeichen vor €. Niemals $.
- TON: Der deutsche Markt ist EXTREM evidenzbasiert. US-Hype ("INSANE results", "lose 10 pounds in a week") = sofortiger Vertrauensverlust. Du musst die DR-Schärfe behalten (Schmerzpunkt, FOMO, Knappheit) ABER mit konkreten Belegen: Studien zitieren (Universität X, Jahr), Inhaltsstoffe / Mechanismus präzise erklären, Stiftung Warentest / Öko-Test referenzieren, TÜV / Made in Germany / Bio-Siegel als Proof. Keine vagen Superlative. Spezifische Zahlen schlagen Adjektive: "94% der Kunden bemerken den Effekt nach 14 Tagen" >>> "AMAZING results".
- KULTUR: Datenschutz ist ernst (DSGVO-Konformität betonen wenn relevant). Apotheke als Autorität (health). Nachhaltigkeit / Bio ist ein echter Kaufgrund, nicht ein Marketing-Buzzword. Klimaneutraler Versand. "Made in Germany" = Premium-Signal. Black Friday existiert aber "Single's Day" und Saisonschlussverkauf zählen mehr. Sonntag = Ruhetag, keine "Hetz-FOMO" am Sonntagabend.
- DO: präzise Zahlen, Studien-Referenzen, Stiftung Warentest / Öko-Test als Proof, Mechanismus erklären, Qualitätssiegel, Made-in-Germany Hervorhebung, sachlicher Direct-Response-Ton.
- DO NOT: US-Hyperbole übersetzt, "AMAZING / INSANE / LIFE-CHANGING" auf Deutsch, vage Versprechen ohne Beleg, Englische Slang-Begriffe ohne Not, $ als Währung.`,

    ITALY: `MARKET: Italy (italiano, € EUR)
- LINGUA: 100% italiano. Marchi inglesi OK. Dare del "tu" su DTC / Meta cold (default), "Lei" solo per lusso / B2B / medicale.
- VALUTA: Euro. Formato: "29 €" / "29,90 €" / "1.299 €" — virgola decimale, punto migliaia, spazio prima dell'€. Mai $.
- TONO: Il mercato italiano è emotivo, visivo, family-oriented. La copy DR funziona ma deve passare per la corda emotiva, non per i numeri da soli (a differenza di DE). Storia, esperienza, gesto quotidiano, ricordo familiare, "finalmente qualcosa che funziona davvero". Hyperbole moderata tollerata se ancorata a una storia concreta. Le testimonianze con nomi italiani (Marco, Giulia, Francesca) e città (Milano, Roma, Napoli, Torino) sono potenti.
- CULTURA: Cibo / cucina / famiglia sono leve enormi anche su prodotti non-food (associazione emozionale). "Made in Italy" = premio puro, va sbattuto in faccia se vero. Farmacia come autorità medica. Saldi estivi (luglio) e invernali (gennaio) > Black Friday in volume di abitudine. Riferimenti regionali (Nord/Sud) se rilevanti. Pranzo della domenica, mamma, nonna sono touchpoint emotivi forti.
- DO: ton emotivo e storia personale, testimonianze italiane specifiche, Made in Italy se vero, riferimenti familiari/culinari/familiari, prezzo in € chiaro.
- DO NOT: traduzione letterale dall'US (suona freddo), tono troppo aggressivo / urlato (l'italiano risponde male agli ALL CAPS), prezzi in $, "Black Friday" come unica leva di urgenza.`,

    SPAIN: `MARKET: Spain (español de España, € EUR)
- LENGUA: Español de España (castellano peninsular). "Vosotros" para el plural informal, "ustedes" solo formal. "Tú" como default en DTC / Meta cold, "usted" solo para premium / lujo / médico. Vocabulario peninsular: "ordenador" (no "computadora"), "móvil" (no "celular"), "coche" (no "carro"), "vale" (= OK), "guay" (= cool, generacional, usar con cuidado).
- MONEDA: Euros. Formato: "29 €" / "29,90 €" / "1.299 €" — coma decimal, punto miles, espacio antes del €. Nunca $.
- TONO: Mercado emocional, cálido, social. La copy DR funciona pero pasa por la conexión humana — historia, comunidad, "finalmente alguien que lo entiende". Hyperbole moderada aceptable si está anclada en historia o prueba concreta. Testimonios con nombres españoles (María, Carlos, Lucía, Javier) y ciudades (Madrid, Barcelona, Valencia, Sevilla, Bilbao). Humor directo, ligeramente irónico, funciona bien.
- CULTURA: Familia y vida social son palancas emocionales fuertes. Verano largo (Sol, playa, vacaciones de agosto — España se vacía). Mediterráneo / dieta mediterránea = referencia salud potente. Rebajas (enero / julio) más fuerte que Black Friday en hábito. Farmacia como autoridad médica. "Hecho en España" / producto local es argumento. Diferenciar de mercado latino — referencias culturales muy distintas (toros, paella, siesta — usar con cuidado, no caricaturar).
- DO: tono cálido y directo, historia personal, testimonios españoles específicos, referencias mediterráneas / familiares, precio en € claro, vocabulario peninsular.
- DO NOT: vocabulario latinoamericano ("computadora", "carro", "ustedes" en informal), traducción literal del US, $ como moneda, caricaturas culturales forzadas (no todo español = flamenco + paella).`,

    US_HISPANIC: `MARKET: US Hispanic Community (español de Estados Unidos, $ USD)
- LENGUA: Español neutro de Estados Unidos — variante latinoamericana panregional, evitando regionalismos fuertes de un solo país (no muy mexicano, no muy caribeño, no muy rioplatense). Code-switching English/Spanish (Spanglish) NATURAL y BIENVENIDO cuando suena orgánico — "el workout", "mi skincare routine", "el coach", "los results" — refleja cómo realmente habla la comunidad bilingüe US. "Tú" / "ustedes" (no "vosotros"). "Computadora", "carro", "celular" (no vocabulario peninsular).
- MONEDA: Dólares estadounidenses. Formato: "$29" / "$29.99" / "$1,299" — punto decimal, coma miles, $ antes del número (formato US). Nunca €.
- TONO: La comunidad hispana en US es bicultural — vive en US pero conserva valores culturales latinos (familia, comunidad, calidez, fe a veces). La copy DR funciona con la misma intensidad que la versión inglesa US (hyperbole, urgencia, prueba social agresiva) PERO con el filtro emocional latino: historia personal, mamá / abuela, comunidad, "para mi familia". Testimonios con nombres latinos (María, José, Carlos, Sofía) y de ciudades con alta población hispana (Miami, Los Angeles, Houston, Phoenix, NYC). Code-switch sutilmente para señalar autenticidad.
- CULTURA: Festividades duales (Thanksgiving + Día de los Muertos / Three Kings Day / Quinceañera). Familia multigeneracional bajo un techo es común. Religión / fe presente sin ser preachy. Bilingual household norm. Comida latina como punto de orgullo. Diferencias internas: mexicano-americano (Suroeste) vs cubano (Florida) vs puertorriqueño (Noreste) — no caricaturar, mantener neutro pan-latino salvo brief específico.
- DO: español neutro panregional, code-switching Spanglish natural, historia familiar/comunidad, prueba social con nombres latinos, intensidad DR estilo US, precio en $.
- DO NOT: español peninsular (vosotros, "ordenador", "móvil"), regionalismos exclusivos de un solo país, traducción robótica de la versión inglesa (suena ofensiva), $ ausente o reemplazado por €.`,
  };

  return HEADER + blocks[market as Exclude<Market, 'US'>];
}
