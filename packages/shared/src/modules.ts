import type { DomainCode, ModuleManifest, ModuleVariant, PlatformMode, Relevance } from './types.js';

/**
 * MODULE CATALOG - the machine readable form of the master specification.
 *
 * Modules 01-10 come from the original defence specification.
 * Modules 11-19 were added when the platform became triple-use: they cover
 * constructs that matter for sport talent identification and occupational
 * fitness but were missing from the defence-only catalog.
 *
 * Every module declares its relevance for all three domains. The hub shows
 * only modules whose relevance is 'primary' or 'secondary' for the selected
 * domain, primary first.
 */

/**
 * Variant pair builder.
 *
 * A is the established form: the published layout, widest platform support.
 * B extends the same paradigm into the third dimension and generally needs a
 * headset. Both measure the same construct; only the task differs, which is
 * why they carry separate configVersions and never share a norm group.
 */
function variants(
  code: string,
  a: Omit<ModuleVariant, 'id' | 'configVersion' | 'spatial'>,
  b: Omit<ModuleVariant, 'id' | 'configVersion' | 'spatial'>
): ModuleVariant[] {
  return [
    { id: 'A', configVersion: `${code}_STANDARD_A`, spatial: false, ...a },
    { id: 'B', configVersion: `${code}_SPATIAL_B`, spatial: true, ...b },
  ];
}

const P = 'primary' as Relevance;
const S = 'secondary' as Relevance;
const N = 'none' as Relevance;

export const MODULES: ModuleManifest[] = [
  /* ================================================================ 01 */
  {
    ordinal: '01',
    code: 'SIGNAL',
    title: 'SIGNAL',
    subtitle: 'Vizuális keresés és anomália-észlelés',
    version: '1.0.0',
    status: 'active',
    duration: 420,
    supports: ['vr', 'desktop', 'mobile'],
    assessmentMode: true,
    challengeMode: true,
    assetLoad: 1,
    codeLoad: 2,
    summary:
      'Hasonló objektumok között kell megtalálni a ritka célt, követni a mozgó tárgyakat, észlelni a ' +
      'változást és a perifériás felvillanást.',
    paradigms: ['Visual search', 'Multiple Object Tracking', 'Change detection'],
    constructs: [
      { id: 'visual_search', label: 'Vizuális keresés', catalogRef: 16 },
      { id: 'selective_attention', label: 'Szelektív figyelem', catalogRef: 22 },
      { id: 'change_detection', label: 'Változásészlelés', catalogRef: 18 },
      { id: 'pattern_recognition', label: 'Mintázatfelismerés', catalogRef: 7 },
      { id: 'peripheral_perception', label: 'Perifériás észlelés', catalogRef: 17 },
      { id: 'scan_coverage', label: 'Pásztázási hatékonyság', catalogRef: 135 },
    ],
    headlineMetrics: ['hit_rate', 'false_positive_rate', 'median_search_time', 'scan_coverage'],
    variants: variants('SIGNAL',
      {
        label: 'Alap',
        subtitle: 'Keresés egy gömbhéjon',
        summary: 'A klasszikus elrendezés: minden objektum azonos távolságban, egy ívelt felületen. ' +
          'Minden platformon fut, és a szakirodalmi keresési meredekséggel közvetlenül összevethető.',
        status: 'active',
        supports: ['vr', 'desktop', 'mobile'],
        duration: 420,
        paradigms: ['Feature and conjunction search', 'Multiple Object Tracking', 'Flicker change detection'],
      },
      {
        label: 'Térbeli',
        subtitle: 'Keresés térfogatban, 360 fokban',
        summary: 'Az objektumok három mélységi rétegben és körben helyezkednek el. Méri, hogy a mélység ' +
          'tudja-e vezérelni a keresést, mennyibe kerül a testfordulás, és mi történik, amikor a követett ' +
          'tárgyak egymás mögé futnak. Headset ajánlott.',
        status: 'active',
        supports: ['vr', 'desktop'],
        duration: 480,
        paradigms: ['Stereoscopic / depth-guided visual search', 'MOT through occlusion', 'Surround search'],
        spatialAffordances: ['depth', 'surround', 'rotation'],
      }),
    domains: {
      A: {
        relevance: P,
        headline: 'Fenyegetés- és anomália-észlelés',
        rationale:
          'A feladat a zajos környezetben megjelenő ritka, releváns eltérések felismerését vizsgálja, ami ' +
          'megfigyelői és őrszolgálati helyzetekben fontos.',
        examples: ['felderítő', 'drónkezelő', 'képelemző', 'őr'],
      },
      B: {
        relevance: P,
        headline: 'Hibafelismerés és minőségellenőrzés',
        rationale:
          'Radarképen, műszerfalon, gyártósoron vagy röntgenfelvételen is fontos, hogy a ritka eltérés időben feltűnjön.',
        examples: ['légiirányító', 'radiológiai asszisztens', 'minőségellenőr', 'biztonsági szkenner-operátor'],
      },
      C: {
        relevance: S,
        headline: 'Játéktér-olvasás',
        rationale:
          'A feladat azt vizsgálja, milyen gyorsan és pontosan található meg egy releváns játékos vagy ' +
          'esemény a mozgó pályaképen.',
        examples: ['labdarúgás', 'kosárlabda', 'vízilabda', 'jégkorong'],
      },
    },
  },

  /* ================================================================ 02 */
  {
    ordinal: '02',
    code: 'SPACE',
    title: 'SPACE',
    subtitle: 'Térbeli orientáció és mentális forgatás',
    version: '1.0.0',
    status: 'external',
    externalUrl: 'https://mindview-vr.vercel.app/',
    duration: 360,
    supports: ['vr', 'desktop', 'mobile'],
    assessmentMode: true,
    challengeMode: false,
    assetLoad: 1,
    codeLoad: 2,
    summary:
      'Térbeli alakzatokat kell fejben elforgatni és összehasonlítani. A már elkészült külső modul ' +
      'eredményét a rendszer azonosító alapján kapcsolja a profilhoz.',
    paradigms: ['Shepard-Metzler mental rotation'],
    constructs: [
      { id: 'mental_rotation', label: 'Mentális forgatás', catalogRef: 11 },
      { id: 'spatial_perception_3d', label: '3D téri észlelés', catalogRef: 12 },
      { id: 'object_assembly', label: 'Objektum-összeillesztés', catalogRef: 13 },
      { id: 'depth_perception', label: 'Mélységészlelés', catalogRef: 20 },
    ],
    headlineMetrics: ['accuracy', 'median_rt', 'rotation_slope'],
    domains: {
      A: {
        relevance: P,
        headline: 'Térbeli modellezés',
        rationale: 'Térkép-terep megfeleltetés, épületbelső elképzelése, műszaki tervrajz olvasása.',
        examples: ['műszaki', 'tüzér', 'navigátor'],
      },
      B: {
        relevance: P,
        headline: 'Műszaki-téri gondolkodás',
        rationale:
          'Sebészeti, fogászati, gépészeti és szerelési feladatokban gyakori a tárgyak és tervek térbeli ' +
          'megfeleltetése; a mérés ezt a teljesítményt vizsgálja.',
        examples: ['sebész', 'fogorvos', 'gépészmérnök', 'CAD-tervező', 'szerelő'],
      },
      C: {
        relevance: S,
        headline: 'Testséma és térbeli forgatás',
        rationale:
          'Forgásokat tartalmazó sportágakban a saját test térbeli helyzetének nyomon követése ' +
          '(légtudat) szorosan összefügg a mentális forgatással.',
        examples: ['torna', 'műugrás', 'akrobatikus sportok', 'snowboard'],
      },
    },
  },

  /* ================================================================ 03 */
  {
    ordinal: '03',
    code: 'NAV',
    title: 'NAV',
    subtitle: 'Navigáció és téri memória',
    version: '1.0.0',
    status: 'active',
    duration: 600,
    supports: ['vr', 'desktop', 'mobile'],
    assessmentMode: true,
    challengeMode: true,
    assetLoad: 2,
    codeLoad: 4,
    summary:
      'Útvonaltanulás, tájékozódás, iránybecslés és a megtanult útvonal felidézése virtuális térben.',
    paradigms: ['Route learning', 'Path integration', 'Wayfinding'],
    constructs: [
      { id: 'spatial_memory', label: 'Téri memória', catalogRef: 15 },
      { id: 'direction_sense', label: 'Irányérzék', catalogRef: 14 },
      { id: 'route_planning', label: 'Útvonaltervezés', catalogRef: 57 },
      { id: 'wayfinding_memory', label: 'Tájékozódási memória', catalogRef: 60 },
      { id: 'lost_position_recognition', label: 'Eltévedés felismerése', catalogRef: 59 },
    ],
    headlineMetrics: ['optimal_route_ratio', 'heading_error', 'recall_accuracy', 'recovery_time'],
    domains: {
      A: {
        relevance: P,
        headline: 'Terepen való tájékozódás',
        rationale: 'Térképolvasás, iránytartás, útvonaltervezés, eltévedés utáni helyreállás.',
        examples: ['gyalogos felderítő', 'navigátor', 'különleges műveleti'],
      },
      B: {
        relevance: S,
        headline: 'Mozgó munkavégzés térben',
        rationale:
          'Nagy létesítményekben, hálózatokon vagy vonalakon dolgozók tájékozódási terhelése; ' +
          'mentők, tűzoltók, karbantartók.',
        examples: ['mentőtiszt', 'tűzoltó', 'raktárlogisztika', 'hálózatszerelő'],
      },
      C: {
        relevance: S,
        headline: 'Terepi és nyíltvízi tájékozódás',
        rationale: 'Ezekben a sportágakban a tájékozódás és az iránytartás a teljesítmény része.',
        examples: ['tájfutás', 'terepfutás', 'vitorlázás', 'sítúra'],
      },
    },
  },

  /* ================================================================ 04 */
  {
    ordinal: '04',
    code: 'REACT',
    title: 'REACT',
    subtitle: 'Reakcióidő és pszichomotoros kontroll',
    version: '1.0.0',
    status: 'active',
    duration: 420,
    supports: ['vr', 'desktop', 'mobile'],
    assessmentMode: true,
    challengeMode: true,
    assetLoad: 1,
    codeLoad: 3,
    hue: 205,
    summary:
      'Öt blokk: egyszerű reakció, választásos reakció, célra mutatás, folyamatos követés, ' +
      'kétkezes koordináció. A platform pszichomotoros alapmérése.',
    paradigms: ['Psychomotor Vigilance Test', 'Choice RT', "Fitts' law pointing", 'Pursuit tracking'],
    constructs: [
      { id: 'simple_reaction_time', label: 'Egyszerű reakcióidő', catalogRef: 31 },
      { id: 'choice_reaction_time', label: 'Választásos reakcióidő', catalogRef: 32 },
      { id: 'hand_eye_coordination', label: 'Szem-kéz koordináció', catalogRef: 33 },
      { id: 'target_tracking', label: 'Célkövetés', catalogRef: 36 },
      { id: 'fine_motor_accuracy', label: 'Finommotoros pontosság', catalogRef: 37 },
      { id: 'bimanual_coordination', label: 'Kétkezes koordináció', catalogRef: 38 },
      { id: 'sensorimotor_integration', label: 'Szenzomotoros integráció', catalogRef: 40 },
      { id: 'processing_speed', label: 'Feldolgozási sebesség', catalogRef: 9 },
      { id: 'speed_accuracy_tradeoff', label: 'Sebesség-pontosság egyensúly', catalogRef: 134 },
    ],
    headlineMetrics: ['median_rt', 'rt_variability', 'lapses', 'tracking_rms', 'pointing_efficiency'],
    variants: variants('REACT',
      {
        label: 'Alap',
        subtitle: 'Reakció és követés egy síkon',
        summary: 'Az ingerek egyetlen, 2,2 méteres síkon jelennek meg. Ez a széles platformtámogatású ' +
          'változat: egérrel és érintéssel is fut, és a klasszikus reakcióidő-tartományokkal összevethető.',
        status: 'active',
        supports: ['vr', 'desktop', 'mobile'],
        duration: 420,
        paradigms: ['Psychomotor Vigilance Test', 'Choice RT', "Fitts' law pointing", 'Pursuit tracking'],
      },
      {
        label: 'Térbeli',
        subtitle: 'Nyúlás és elfogás karnyújtásnyira',
        summary: 'Valódi nyúlás három távolságban (3D Fitts), közeledő tárgyak elfogása, mélységi ' +
          'komponensű követés, kétkezes koordináció eltérő távolságban. Csak headsettel értelmes.',
        status: 'active',
        supports: ['vr'],
        duration: 480,
        paradigms: ["Fitts' law in three dimensions", 'Interceptive action', '3D pursuit tracking'],
        spatialAffordances: ['peripersonal', 'depth', 'approach'],
      }),
    domains: {
      A: {
        relevance: P,
        headline: 'Reakció és eszközkezelési alapmozgások',
        rationale:
          'Az időkritikus feladatokban a reakcióidő mellett annak ingadozása is fontos; a mérés mindkettőt külön rögzíti.',
        examples: ['minden beosztás', 'járművezető', 'légvédelmi kezelő'],
      },
      B: {
        relevance: P,
        headline: 'Biztonságkritikus reakcióteljesítmény',
        rationale:
          'A feladat a reakcióidőt, a lassú válaszok arányát és a követés pontosságát méri. Ezek a mutatók ' +
          'műszakos vagy figyelmet igénylő munkában relevánsak.',
        examples: ['gépjárművezető', 'mozdonyvezető', 'daruvezető', 'műszakos operátor'],
      },
      C: {
        relevance: P,
        headline: 'Startreakció és követőmozgás',
        rationale:
          'Rajt, ütéselhárítás és labdakövetés közben is fontos a gyors, pontos válasz és a folyamatos ' +
          'vizuomotoros követés.',
        examples: ['sprint', 'asztalitenisz', 'vívás', 'ökölvívás', 'motorsport'],
      },
    },
  },

  /* ================================================================ 05 */
  {
    ordinal: '05',
    code: 'MULTI',
    title: 'MULTI',
    subtitle: 'Többfeladatos terhelés',
    version: '0.1.0',
    status: 'active',
    duration: 600,
    supports: ['vr', 'desktop', 'mobile'],
    assessmentMode: true,
    challengeMode: true,
    assetLoad: 1,
    codeLoad: 4,
    summary:
      'Négy állomás működik párhuzamosan: követés, rendszerfigyelés, tartályszintek kezelése és ' +
      'rádiózás. A fő mutató az egyidejű feladatok többletterhe.',
    paradigms: ['NASA MATB-II'],
    constructs: [
      { id: 'divided_attention', label: 'Megosztott figyelem', catalogRef: 23 },
      { id: 'multitasking', label: 'Többfeladatosság', catalogRef: 24 },
      { id: 'task_switching', label: 'Feladatváltás', catalogRef: 28 },
      { id: 'information_overload', label: 'Információs túlterhelés', catalogRef: 50 },
      { id: 'dual_task_cost', label: 'Kettős feladatterhelés', catalogRef: 131 },
      { id: 'speech_in_noise', label: 'Beszédértés zajban', catalogRef: 94 },
    ],
    headlineMetrics: ['dual_task_cost', 'tracking_rms', 'monitor_hit_rate', 'audio_hit_rate'],
    domains: {
      A: {
        relevance: P,
        headline: 'Harcálláspont-terhelés',
        rationale: 'Rádió, műszer, célkövetés és döntés egyidejűleg — a vezetői terhelés modellje.',
        examples: ['harcjárművezető', 'pilóta', 'harcálláspont-kezelő'],
      },
      B: {
        relevance: P,
        headline: 'Kabin- és diszpécserterhelés',
        rationale:
          'Légiirányítás, mentésirányítás, aneszteziológia: a párhuzamos csatornák kezelése ' +
          'a munkakör lényege, nem mellékkörülménye.',
        examples: ['légiirányító', 'diszpécser', 'aneszteziológus', 'pilóta'],
      },
      C: {
        relevance: S,
        headline: 'Osztott figyelem játék közben',
        rationale: 'Labda + védő + társ + edzői utasítás egyszerre; csapatsportok terhelése.',
        examples: ['kosárlabda', 'kézilabda', 'rally-navigátor', 'vitorlázás'],
      },
    },
  },

  /* ================================================================ 06 */
  {
    ordinal: '06',
    code: 'WATCH',
    title: 'WATCH',
    subtitle: 'Éberség és perifériás figyelem',
    version: '1.0.0',
    status: 'active',
    duration: 660,
    supports: ['vr', 'desktop', 'mobile'],
    assessmentMode: true,
    challengeMode: false,
    assetLoad: 1,
    codeLoad: 3,
    summary:
      'Hosszú, monoton ingerfolyamban kell felismerni a ritka eltéréseket. A fő mutató azt jelzi, ' +
      'hogyan változik a teljesítmény az idő előrehaladtával.',
    paradigms: ['Mackworth Clock Test', 'Signal detection theory'],
    constructs: [
      { id: 'sustained_attention', label: 'Tartós figyelem', catalogRef: 21 },
      { id: 'vigilance_decrement', label: 'Éberség-lejtés', catalogRef: 132 },
      { id: 'peripheral_perception', label: 'Perifériás észlelés', catalogRef: 17 },
      { id: 'sound_direction', label: 'Hangirány-felismerés', catalogRef: 93 },
      { id: 'fatigue_performance', label: 'Fáradtság alatti teljesítmény', catalogRef: 70 },
    ],
    headlineMetrics: ['hit_rate', 'false_alarms', 'vigilance_decrement', 'd_prime'],
    domains: {
      A: {
        relevance: P,
        headline: 'Őr- és megfigyelőszolgálat',
        rationale: 'Órákig tartó monoton figyelés ritka, de kritikus eseményekre.',
        examples: ['őr', 'szenzoroperátor', 'ügyeletes'],
      },
      B: {
        relevance: P,
        headline: 'Műszakos éberség',
        rationale:
          'Éjszakai műszakban, vezérlőteremben és hosszú vezetés közben fontos, hogyan változik a ritka ' +
          'események észlelése az idő előrehaladtával.',
        examples: ['vezérlőterem-operátor', 'kamionsofőr', 'biztonsági őr', 'éjszakás ápoló'],
      },
      C: {
        relevance: S,
        headline: 'Hosszú versenyek koncentrációja',
        rationale: 'Íjászat, sportlövészet, hosszútávú vitorlázás, ultrafutás fókusz-stabilitása.',
        examples: ['sportlövészet', 'íjászat', 'ultrafutás', 'vitorlázás'],
      },
    },
  },

  /* ================================================================ 07 */
  {
    ordinal: '07',
    code: 'PRESSURE',
    title: 'PRESSURE',
    subtitle: 'Teljesítmény kognitív nyomás alatt',
    version: '1.0.0',
    status: 'active',
    duration: 480,
    supports: ['vr', 'desktop', 'mobile'],
    assessmentMode: true,
    challengeMode: true,
    assetLoad: 1,
    codeLoad: 3,
    summary:
      'Időnyomás, gyorsuló ingerek, szabályváltás és zavaró hangok mellett méri a teljesítményt. A fő ' +
      'mutató a hiba utáni helyreállás.',
    paradigms: ['Stroop interference', 'Task-set switching', 'Time pressure'],
    constructs: [
      { id: 'cognitive_flexibility', label: 'Kognitív flexibilitás', catalogRef: 28 },
      { id: 'attention_under_stress', label: 'Figyelem nyomás alatt', catalogRef: 29 },
      { id: 'time_pressure_decision', label: 'Időnyomásos döntés', catalogRef: 51 },
      { id: 'decision_under_uncertainty', label: 'Döntés bizonytalanságban', catalogRef: 52 },
      { id: 'post_error_recovery', label: 'Hiba utáni helyreállás', catalogRef: 133 },
      { id: 'rule_change_cost', label: 'Szabályváltás költsége', catalogRef: 136 },
    ],
    headlineMetrics: ['accuracy_under_load', 'post_error_recovery', 'rule_change_cost', 'stability'],
    variants: variants('PRESSURE',
      {
        label: 'Alap',
        subtitle: 'Dimenzionális konfliktus középen',
        summary: 'Egyetlen központi inger, szín-alak konfliktussal. Stroop- és feladatváltási logika, ' +
          'minden platformon azonos, és a különbség-alapú mutatók eszközfüggetlenek.',
        status: 'active',
        supports: ['vr', 'desktop', 'mobile'],
        duration: 480,
        paradigms: ['Dimensional Stroop', 'Cued task switching', 'Response deadline'],
      },
      {
        label: 'Térbeli',
        subtitle: 'Simon-hatás és figyelmi szűkülés',
        summary: 'Az ingerek körülötted jelennek meg, és a helyük ütközik a kért válasz irányával ' +
          '(Simon-hatás), mélységben is. Nyomás alatt méri, hogy szűkül-e a ténylegesen figyelt látómező.',
        status: 'active',
        supports: ['vr'],
        duration: 540,
        paradigms: ['Simon effect (spatial S-R compatibility)', 'Depth-based Simon', 'Attentional narrowing under load'],
        spatialAffordances: ['surround', 'depth'],
      }),
    domains: {
      A: {
        relevance: P,
        headline: 'Harci stressz kognitív komponense',
        rationale: 'A döntések pontosságának és idejének változását méri kognitív terhelés alatt.',
        examples: ['minden harcoló beosztás', 'parancsnok'],
      },
      B: {
        relevance: P,
        headline: 'Krízisteljesítmény',
        rationale:
          'Riasztás, szövődmény, forgalmi vészhelyzet: az számít, mennyire esik szét a ' +
          'teljesítmény és milyen gyorsan áll helyre egy hiba után.',
        examples: ['sürgősségi orvos', 'légiirányító', 'mentő', 'tőzsdei kereskedő'],
      },
      C: {
        relevance: P,
        headline: 'Versenyhelyzeti stabilitás',
        rationale:
          'A feladat azt méri, hogyan változik a pontosság és a döntési idő, amikor nő a tét és gyorsul a tempó.',
        examples: ['büntetőrúgás', 'tenisz', 'sportlövészet', 'küzdősportok'],
      },
    },
  },

  /* ================================================================ 08 */
  {
    ordinal: '08',
    code: 'HOLD',
    title: 'HOLD',
    subtitle: 'Válaszgátlás és impulzuskontroll',
    version: '1.0.0',
    status: 'active',
    duration: 420,
    supports: ['vr', 'desktop', 'mobile'],
    assessmentMode: true,
    challengeMode: true,
    assetLoad: 1,
    codeLoad: 3,
    summary:
      'Válaszolni, amikor kell, és visszatartani vagy megállítani a választ, amikor nem szabad. ' +
      'Absztrakt ingerek és menet közbeni szabályváltás.',
    paradigms: ['Go/No-Go', 'Stop-Signal Task'],
    constructs: [
      { id: 'response_inhibition', label: 'Válaszgátlás', catalogRef: 63 },
      { id: 'impulse_control', label: 'Impulzuskontroll', catalogRef: 63 },
      { id: 'choice_reaction_time', label: 'Választásos reakcióidő', catalogRef: 32 },
      { id: 'target_discrimination', label: 'Célpont-megkülönböztetés', catalogRef: 114 },
      { id: 'rule_change_cost', label: 'Szabályváltás költsége', catalogRef: 136 },
    ],
    headlineMetrics: ['commission_errors', 'omission_errors', 'ssrt', 'rule_change_cost'],
    domains: {
      A: {
        relevance: P,
        headline: 'Tűzmegnyitási fegyelem (absztrakt)',
        rationale:
          'A „shoot / no-shoot” döntés absztrakt megfelelője embermodell és fegyver nélkül. A gátlási hiba ' +
          'drágább, mint a késés — a pontozás ezt tükrözi.',
        examples: ['harcoló beosztás', 'ellenőrzőpont-szolgálat', 'rendész'],
      },
      B: {
        relevance: P,
        headline: 'Biztonsági önfegyelem',
        rationale:
          'Vészleállításnál, biztonsági eljárásoknál és más időkritikus helyzetekben fontos a már ' +
          'megkezdett válasz visszatartása; a feladat ezt a teljesítményt méri.',
        examples: ['gépkezelő', 'sofőr', 'sebész', 'vegyipari operátor'],
      },
      C: {
        relevance: P,
        headline: 'Cselezés-ellenállás és fegyelmezett indulás',
        rationale:
          'A feladat a már megkezdett mozdulat megállítását vizsgálja, ami cselhelyzetben és rajtnál is releváns.',
        examples: ['kapus', 'vívás', 'kosárlabda-védekezés', 'sprintrajt'],
      },
    },
  },

  /* ================================================================ 09 */
  {
    ordinal: '09',
    code: 'MEMORY',
    title: 'MEMORY',
    subtitle: 'Munkamemória',
    version: '1.0.0',
    status: 'active',
    duration: 480,
    supports: ['vr', 'desktop', 'mobile'],
    assessmentMode: true,
    challengeMode: true,
    assetLoad: 1,
    codeLoad: 3,
    summary:
      'Térbeli sorozatok, alakzat–hely párosítás, folyamatos frissítés és felidézés zavaró feladat ' +
      'után, Corsi- és kétlépéses logikával.',
    paradigms: ['Corsi Block-Tapping', 'N-back', 'Delayed recall'],
    constructs: [
      { id: 'working_memory', label: 'Munkamemória', catalogRef: 25 },
      { id: 'visual_memory', label: 'Vizuális memória', catalogRef: 26 },
      { id: 'auditory_memory', label: 'Hallási memória', catalogRef: 27 },
      { id: 'recall_after_distraction', label: 'Felidézés zavarás után', catalogRef: 30 },
      { id: 'command_interpretation', label: 'Utasításértelmezés', catalogRef: 88 },
    ],
    headlineMetrics: ['span', 'nback_dprime', 'recall_accuracy', 'interference_cost'],
    domains: {
      A: {
        relevance: P,
        headline: 'Parancsmegtartás és jelentés',
        rationale: 'Rádión kapott koordináta, hívójel, sorrend pontos megtartása terhelés alatt.',
        examples: ['rádiós', 'tüzérségi irányító', 'parancsnok'],
      },
      B: {
        relevance: P,
        headline: 'Munkamemória-kapacitás',
        rationale:
          'Gyógyszeradagolás, klíringszám, ellenőrzőlista, ügyfélinformáció fejben tartása zavaró ' +
          'környezetben — a legtöbb hibázás forrása.',
        examples: ['ápoló', 'gyógyszerész', 'pénzügyi ügyintéző', 'pilóta'],
      },
      C: {
        relevance: S,
        headline: 'Taktikai utasítás megjegyzése',
        rationale: 'Beadott játékrendszer, edzői instrukció, koreográfia pontos felidézése.',
        examples: ['amerikai futball', 'kosárlabda', 'műkorcsolya', 'torna'],
      },
    },
  },

  /* ================================================================ 10 */
  {
    ordinal: '10',
    code: 'COMMAND',
    title: 'COMMAND',
    subtitle: 'Csapat, problémamegoldás és vezetés',
    version: '1.0.0',
    status: 'active',
    duration: 900,
    supports: ['vr', 'desktop', 'mobile'],
    assessmentMode: true,
    challengeMode: false,
    assetLoad: 1,
    codeLoad: 4,
    hue: 30,
    multiuser: { min: 2, max: 5, botsSupported: true },
    summary:
      'Több résztvevő, megosztott információ, közös terv. Egy kör vezető nélkül, egy kör ' +
      'kijelölt vezetővel. Csak kommunikációval oldható meg.',
    paradigms: ['Leaderless group discussion', 'Command task', 'Hidden profile paradigm'],
    constructs: [
      { id: 'team_communication', label: 'Csapatkommunikáció', catalogRef: 81 },
      { id: 'cooperative_problem_solving', label: 'Együttműködő problémamegoldás', catalogRef: 82 },
      { id: 'leadership_potential', label: 'Vezetői viselkedés', catalogRef: 83 },
      { id: 'delegation', label: 'Delegálás', catalogRef: 84 },
      { id: 'resource_allocation', label: 'Erőforrás-elosztás', catalogRef: 85 },
      { id: 'prioritisation', label: 'Prioritáskezelés', catalogRef: 43 },
      { id: 'information_sharing', label: 'Információmegosztás', catalogRef: 82 },
      { id: 'conflict_management', label: 'Konfliktuskezelés', catalogRef: 86 },
    ],
    headlineMetrics: [
      'plan_optimality',
      'information_sharing_rate',
      'time_to_commit',
      'leadership_index',
      'adoption_rate',
    ],
    variants: variants('COMMAND',
      {
        label: 'Alap',
        subtitle: 'Közös tábla, titkos kártyák',
        summary: 'Vízszintes logisztikai tábla, szöveges információkülönbségekkel: minden résztvevő két olyan ' +
          'javítást ismer, amelyet a többiek nem. Minden támogatott platformon futtatható.',
        status: 'active',
        supports: ['vr', 'desktop', 'mobile'],
        duration: 900,
        paradigms: ['Leaderless group discussion', 'Command task', 'Hidden profile'],
      },
      {
        label: 'Térbeli',
        subtitle: 'Amit onnan látsz, ahol állsz',
        summary: 'Egy lebegő térbeli szerkezetet mindenki más szögből lát, és a blokkok takarják egymást — ' +
          'senki nem látja az egészet. Az információaszimmetria itt nem szöveg, hanem nézőpont.',
        status: 'active',
        supports: ['vr', 'desktop'],
        duration: 900,
        paradigms: ['Hidden profile with perceptual asymmetry', 'Shared situational awareness', 'Spatial referencing'],
        spatialAffordances: ['hidden_transform', 'depth', 'rotation'],
      }),
    domains: {
      A: {
        relevance: P,
        headline: 'Parancsnoki és csapatfeladat',
        rationale:
          'Tisztjelölt-kiválasztás bevált formátumának absztrakt VR változata: vezető nélküli ' +
          'csoportfeladat, majd kijelölt parancsnokkal futó kör.',
        examples: ['tisztjelölt', 'raj- és szakaszparancsnok'],
      },
      B: {
        relevance: P,
        headline: 'Vezetői és csapatmunka-helyzet',
        rationale:
          'A közös feladatban mérhető, ki oszt meg információt, mely javaslatokat fogadja el a csapat, és ' +
          'hogyan alakul a delegálás és az együttműködés.',
        examples: ['középvezető-kiválasztás', 'projektmenedzser', 'műszakvezető', 'krízisstáb'],
      },
      C: {
        relevance: S,
        headline: 'Csapatkohézió és pályán belüli vezetés',
        rationale:
          'A feladatban megfigyelhető, ki kezdeményez döntést információhiányban, hogyan oszlik meg az ' +
          'információ, és kinek a javaslatait fogadja el a csapat.',
        examples: ['csapatkapitány-kiválasztás', 'evezős nyolcas', 'váltó', 'kosárlabda'],
      },
    },
  },

  /* ================================================================ 11 - NEW */
  {
    ordinal: '11',
    code: 'ANTICIPATE',
    title: 'ANTICIPATE',
    subtitle: 'Időzítés és előrejelzés',
    version: '1.0.0',
    status: 'active',
    duration: 360,
    supports: ['vr', 'desktop', 'mobile'],
    assessmentMode: true,
    challengeMode: true,
    assetLoad: 1,
    codeLoad: 3,
    hue: 140,
    summary:
      'A mozgó gömb takarásba kerül, és akkor kell válaszolni, amikor elérné a célt. A feladat a ' +
      'pontos időzítést és a mozgás időbeli továbbvezetését méri.',
    paradigms: ['Coincidence-anticipation timing (Bassin)', 'Temporal occlusion', 'Time-to-contact estimation'],
    constructs: [
      { id: 'coincidence_timing', label: 'Érkezési időzítés' },
      { id: 'time_to_contact', label: 'Ütközési idő becslése' },
      { id: 'motion_extrapolation', label: 'A mozgás folytatásának becslése' },
      { id: 'temporal_prediction', label: 'Időbeli előrejelzés' },
      { id: 'velocity_discrimination', label: 'Sebesség-megkülönböztetés' },
    ],
    headlineMetrics: ['timing_error_ms', 'timing_variability', 'constant_error', 'occlusion_robustness'],
    variants: variants('ANTICIPATE',
      {
        label: 'Alap',
        subtitle: 'Oldalirányú koincidencia-időzítés',
        summary: 'A gömb sínen halad a cél felé, takarással. Ez a Bassin-féle készülék elrendezése, ' +
          'minden platformon fut, és a CE/VE/AE hármassal közvetlenül összevethető a szakirodalommal.',
        status: 'active',
        supports: ['vr', 'desktop', 'mobile'],
        duration: 360,
        paradigms: ['Coincidence-anticipation timing (Bassin)', 'Temporal occlusion'],
      },
      {
        label: 'Térbeli',
        subtitle: 'Feléd érkező tárgy időzítése',
        summary: 'A tárgy feléd repül, és az érkezését a látható mozgásból kell időzítened. A változat a közeledő ' +
          'tárgyak érkezési idejének becslését vizsgálja.',
        status: 'active',
        supports: ['vr', 'desktop'],
        duration: 420,
        paradigms: ['Time-to-contact estimation (tau)', 'Size-arrival effect', 'Prediction motion'],
        spatialAffordances: ['approach', 'depth'],
      }),
    domains: {
      A: {
        relevance: S,
        headline: 'Vezetési és célzási időzítés',
        rationale: 'Mozgó cél előretartása, járműtávolság-becslés, konvoj-követés.',
        examples: ['járművezető', 'légvédelmi kezelő'],
      },
      B: {
        relevance: P,
        headline: 'Ütközési idő becslése vezetés közben',
        rationale:
          'Előzés, kanyarodás, féktávolság: a baleseti kockázat egyik legjobban mérhető ' +
          'percepciós összetevője. Daru- és targoncakezelésnél is közvetlenül releváns.',
        examples: ['gépjárművezető', 'darukezelő', 'targoncás', 'vasúti forgalmi'],
      },
      C: {
        relevance: P,
        headline: 'Labdaérkezés időzítése',
        rationale:
          'Ütő-, dobó- és elkapósportokban fontos a labda érkezésének pontos becslése. A takarásos rész ' +
          'azt vizsgálja, hogyan folytatódik a becslés, amikor a pálya vége már nem látható.',
        examples: ['teniszfogadás', 'baseball', 'krikett', 'asztalitenisz', 'röplabda'],
      },
    },
  },

  /* ================================================================ 12 - NEW */
  {
    ordinal: '12',
    code: 'FIELD',
    title: 'FIELD',
    subtitle: 'Hasznos látómező és dinamikus látásélesség',
    version: '1.0.0',
    status: 'active',
    duration: 660,
    supports: ['vr', 'desktop', 'mobile'],
    assessmentMode: true,
    challengeMode: true,
    assetLoad: 1,
    codeLoad: 3,
    hue: 190,
    summary:
      'Egy központi feladat mellett röviden felvillanó, oldalsó inger helyét kell felismerni, egyre ' +
      'távolabb a középponttól és zavaró háttérben.',
    paradigms: ['Useful Field of View (UFOV)', 'Dynamic visual acuity', 'Divided attention field test'],
    constructs: [
      { id: 'useful_field_of_view', label: 'Hasznos látómező' },
      { id: 'dynamic_visual_acuity', label: 'Dinamikus látásélesség' },
      { id: 'peripheral_perception', label: 'Perifériás észlelés', catalogRef: 17 },
      { id: 'divided_attention', label: 'Megosztott figyelem', catalogRef: 23 },
      { id: 'attentional_field_shrinkage', label: 'Látómező-szűkülés terhelés alatt' },
    ],
    headlineMetrics: ['field_radius_deg', 'ufov_threshold_ms', 'depth_field_cost', 'dva_threshold_dps'],
    domains: {
      A: {
        relevance: S,
        headline: 'Perifériás helyzetfelismerés',
        rationale: 'A feladat azt méri, hogyan változik a perifériás események felismerése kontrollált terhelés mellett.',
        examples: ['harcoló beosztás', 'járőr'],
      },
      B: {
        relevance: P,
        headline: 'Vezetői látómező',
        rationale:
          'A hasznos látómező közlekedési helyzetekben is releváns, különösen fáradtság és nagyobb életkor ' +
          'mellett; az eredmény csak erre a feladatra vonatkozik.',
        examples: ['hivatásos sofőr', 'buszvezető', 'idősvezetői felülvizsgálat', 'gépkezelő'],
      },
      C: {
        relevance: P,
        headline: 'Pályakép szélessége',
        rationale:
          'A „jó játéklátás” nagyrészt hasznos látómező: mennyit vesz észre a periférián anélkül, hogy a ' +
          'labdáról levenné a tekintetét.',
        examples: ['labdarúgó irányító', 'kosárlabda-átlövő', 'kézilabda-irányító', 'jégkorong'],
      },
    },
  },

  /* ================================================================ 13 - NEW */
  {
    ordinal: '13',
    code: 'STEADY',
    title: 'STEADY',
    subtitle: 'Poszturális stabilitás és kéznyugalom',
    version: '1.0.0',
    status: 'active',
    duration: 330,
    supports: ['vr'],
    assessmentMode: true,
    challengeMode: false,
    assetLoad: 1,
    codeLoad: 2,
    hue: 260,
    summary:
      'A headset és a kontrollerek mozgásából számított testlengés és kéztremor. Nyitott vagy ' +
      'elsötétített nézet, egy lábon állás, mozgó látvány és célon tartás.',
    paradigms: ['Romberg / posturography', 'Hand steadiness test', 'Sensory reweighting'],
    constructs: [
      { id: 'postural_stability', label: 'Poszturális stabilitás' },
      { id: 'balance', label: 'Egyensúly', catalogRef: 95 },
      { id: 'hand_steadiness', label: 'Kéznyugalom / tremor' },
      { id: 'visual_dependence', label: 'Vizuális függés' },
      { id: 'sensorimotor_integration', label: 'Szenzomotoros integráció', catalogRef: 40 },
    ],
    headlineMetrics: ['sway_area_95_mm2', 'romberg_quotient', 'visual_reliance_gain', 'tremor_rms_mm'],
    domains: {
      A: {
        relevance: S,
        headline: 'Terhelés alatti testkontroll',
        rationale: 'A feladat a testlengést és a kéz apró mozgásait méri különböző vizuális és testhelyzeti feltételek mellett.',
        examples: ['lövész', 'ejtőernyős', 'visszatérési szűrés'],
      },
      B: {
        relevance: P,
        headline: 'Magasban végzett és finommunka',
        rationale:
          'Magasban végzett munka, sebészet, fogászat és mikroelektronika közben is releváns a test és a ' +
          'kéz mozgásának stabilitása; itt a headset és a kontrollerek rögzítik ezt.',
        examples: ['sebész', 'fogorvos', 'állványozó', 'mikroszerelő', 'laboráns'],
      },
      C: {
        relevance: P,
        headline: 'Statikus és dinamikus egyensúly',
        rationale:
          'Egyensúlyigényes sportágakban és terhelés utáni állapotkövetésben releváns lehet a testlengés ' +
          'objektív rögzítése. Ez nem orvosi vizsgálat.',
        examples: ['torna', 'sílesiklás', 'szörf', 'íjászat', 'agyrázkódás utáni return-to-play'],
      },
    },
  },

  /* ================================================================ 14 - NEW */
  {
    ordinal: '14',
    code: 'RHYTHM',
    title: 'RHYTHM',
    subtitle: 'Motoros időzítés és ritmusszinkronizáció',
    version: '1.0.0',
    status: 'active',
    duration: 540,
    supports: ['vr', 'desktop', 'mobile'],
    assessmentMode: true,
    challengeMode: true,
    assetLoad: 1,
    codeLoad: 2,
    hue: 320,
    summary:
      'Először egy hallható vagy látható ütemhez kell igazodni, majd a jelzés megszűnése után tartani ' +
      'a tempót. Kétkezes és eltérő ütemű rész is van.',
    paradigms: ['Sensorimotor synchronisation', 'Synchronisation-continuation tapping', 'Polyrhythm'],
    constructs: [
      { id: 'motor_timing', label: 'Motoros időzítés' },
      { id: 'rhythmic_synchronisation', label: 'Ritmusszinkronizáció' },
      { id: 'internal_clock_stability', label: 'Belső óra stabilitása' },
      { id: 'bimanual_coordination', label: 'Kétkezes koordináció', catalogRef: 38 },
      { id: 'tempo_adaptation', label: 'Tempóváltás-adaptáció' },
    ],
    headlineMetrics: ['async_sd_ms', 'continuation_sd_ms', 'visual_continuity_gain', 'poly_accuracy'],
    domains: {
      A: {
        relevance: N,
        rationale: 'Nem elsődleges védelmi konstruktum; adatot gyűjtünk, de nem jelenítjük meg alapból.',
      },
      B: {
        relevance: S,
        headline: 'Ciklikus munkavégzés üteme',
        rationale: 'Gyártósori ütemtartás, zenei és előadóművészi pályák, ütemezett kétkezes munka.',
        examples: ['gyártósori operátor', 'zenész', 'gépíró', 'sebészasszisztens'],
      },
      C: {
        relevance: P,
        headline: 'Mozgásritmus és ciklustartás',
        rationale:
          'Evezésben, úszásban, futásban és szinkron sportokban is fontos az ütem tartása; a feladat ennek ' +
          'pontosságát és ingadozását méri.',
        examples: ['evezés', 'úszás', 'gátfutás', 'szinkronúszás', 'ritmikus gimnasztika', 'tánc'],
      },
    },
  },

  /* ================================================================ 15 - NEW */
  {
    ordinal: '15',
    code: 'ADAPT',
    title: 'ADAPT',
    subtitle: 'Mozgástanulási ráta és vizuomotoros adaptáció',
    version: '1.0.0',
    status: 'active',
    duration: 600,
    supports: ['vr', 'desktop', 'mobile'],
    assessmentMode: true,
    challengeMode: false,
    assetLoad: 1,
    codeLoad: 3,
    hue: 95,
    summary:
      'Ismételt célzó mozdulatok során méri, hogyan változik a pontosság, mekkora az utóhatás, és ' +
      'milyen gyors az újratanulás.',
    paradigms: ['Visuomotor rotation adaptation', 'Prism adaptation', 'Savings & aftereffect'],
    constructs: [
      { id: 'motor_learning_rate', label: 'Mozgástanulási ráta' },
      { id: 'visuomotor_adaptation', label: 'Vizuomotoros adaptáció' },
      { id: 'aftereffect_magnitude', label: 'Utóhatás nagysága' },
      { id: 'savings', label: 'Újratanulási előny (savings)' },
      { id: 'explicit_implicit_ratio', label: 'Explicit/implicit tanulás aránya' },
    ],
    headlineMetrics: ['adaptation_rate_trials', 'asymptotic_error_deg', 'aftereffect_deg', 'savings_index'],
    domains: {
      A: {
        relevance: S,
        headline: 'Új eszközre való átállás sebessége',
        rationale: 'Új fegyverrendszer, új kezelőfelület, éjjellátó okozta perceptuális eltolódás megtanulása.',
        examples: ['rendszerváltás', 'új platformra átképzés'],
      },
      B: {
        relevance: P,
        headline: 'Tanulási ráta ismételt mozdulatokban',
        rationale:
          'A feladat azt méri, hogyan változik a mozgás pontossága azonos számú ismétlés során. Az ' +
          'eredmény az ebben a feladatban megfigyelt tanulási görbét írja le.',
        examples: ['laparoszkópos sebészet', 'távirányított gépkezelés', 'CNC-betanulás', 'pályaorientáció'],
      },
      C: {
        relevance: P,
        headline: 'Mozgástanulási ráta',
        rationale:
          'A jelenlegi teljesítmény mellett az is megfigyelhető, mennyit változik a pontosság azonos számú ' +
          'ismétlés alatt.',
        examples: ['utánpótlás-szűrés', 'technikai sportágak', 'sportágváltás'],
      },
    },
  },

  /* ================================================================ 16 - NEW */
  {
    ordinal: '16',
    code: 'HANDS',
    title: 'HANDS',
    subtitle: 'Finom manuális ügyesség',
    version: '0.1.0',
    status: 'active',
    duration: 360,
    supports: ['vr'],
    assessmentMode: true,
    challengeMode: true,
    assetLoad: 1,
    codeLoad: 3,
    hue: 45,
    summary:
      'Apró elemek pontos megfogása, áthelyezése és szűk pályán való átvezetése két kézzel. A rendszer ' +
      'méri az időt, a mozgáspályát és az érintési hibákat.',
    paradigms: ['Purdue Pegboard', 'Grooved Pegboard', 'Buzz-wire tracing'],
    constructs: [
      { id: 'manual_dexterity', label: 'Manuális ügyesség' },
      { id: 'fine_motor_accuracy', label: 'Finommotoros pontosság', catalogRef: 37 },
      { id: 'bimanual_coordination', label: 'Kétkezes koordináció', catalogRef: 38 },
      { id: 'grip_precision', label: 'Fogásprecizitás' },
      { id: 'movement_smoothness', label: 'Mozgássimaság' },
    ],
    headlineMetrics: ['placements_per_min', 'wall_contacts', 'path_jerk', 'bimanual_asymmetry'],
    domains: {
      A: {
        relevance: S,
        headline: 'Műszaki és fegyverkezelési kézügyesség',
        rationale: 'Szerelés, hibaelhárítás, kesztyűben végzett finommunka.',
        examples: ['műszerész', 'tűzszerész-támogatás', 'híradó szerelő'],
      },
      B: {
        relevance: P,
        headline: 'Kézügyességi feladatteljesítmény',
        rationale:
          'A pálcikaelhelyezési feladatok a finom kézmozgás sebességét és pontosságát mérik; VR-ban a ' +
          'mozgáspálya és az érintési hibák is automatikusan rögzíthetők.',
        examples: ['sebész', 'fogorvos', 'órás', 'elektronikai szerelő', 'fodrász', 'szakács'],
      },
      C: {
        relevance: S,
        headline: 'Kézprecizitás technikai sportágakban',
        rationale: 'Sportlövészet, íjászat, biliárd, e-sport: a mikromozgás minősége dönt.',
        examples: ['sportlövészet', 'íjászat', 'biliárd', 'e-sport'],
      },
    },
  },

  /* ================================================================ 17 - NEW */
  {
    ordinal: '17',
    code: 'RISK',
    title: 'RISK',
    subtitle: 'Kockázatvállalás és döntési stílus',
    version: '0.1.0',
    status: 'active',
    duration: 420,
    supports: ['vr', 'desktop', 'mobile'],
    assessmentMode: true,
    challengeMode: false,
    assetLoad: 1,
    codeLoad: 2,
    hue: 10,
    summary:
      'Ismételt nyereség–veszteség döntések növekvő téttel és megtapasztalható valószínűségekkel. A ' +
      'mérés az ebben a feladatban megfigyelt döntési viselkedést írja le.',
    paradigms: ['Balloon Analogue Risk Task (BART)', 'Iowa Gambling Task', 'Probabilistic learning'],
    constructs: [
      { id: 'risk_taking_behaviour', label: 'Kockázatvállalási viselkedés', catalogRef: 65 },
      { id: 'risk_assessment', label: 'Kockázatértékelés', catalogRef: 44 },
      { id: 'decision_under_uncertainty', label: 'Döntés bizonytalanságban', catalogRef: 52 },
      { id: 'feedback_learning', label: 'Visszajelzés alapú tanulás' },
      { id: 'loss_chasing', label: 'Veszteségkövetés' },
    ],
    headlineMetrics: ['adjusted_risk_index', 'learning_slope', 'loss_chasing_index', 'decision_consistency'],
    domains: {
      A: {
        relevance: S,
        headline: 'Kockázatkezelés műveleti döntésekben',
        rationale: 'A feladatban megfigyelhető, hogyan változnak a döntések bizonytalan kimenetel és ismételt ' +
          'visszajelzés mellett.',
        examples: ['parancsnoki kiválasztás', 'tűzszerész', 'pilóta'],
      },
      B: {
        relevance: P,
        headline: 'Biztonsági és pénzügyi kockázatkezelés',
        rationale:
          'Munkabiztonsági szabályszegés és pénzügyi kockázatvállalás egyaránt visszavezethető ' +
          'a visszajelzésből való tanulás mintázatára.',
        examples: ['munkavédelmi kockázatszűrés', 'kereskedő', 'projektvezető', 'gépkezelő'],
      },
      C: {
        relevance: P,
        headline: 'Taktikai kockázatvállalás',
        rationale:
          'Versenyhelyzetben gyakori a biztosabb és a kockázatosabb döntés közötti választás; a feladat az ' +
          'ismételt döntések mintázatát figyeli meg.',
        examples: ['kerékpáros szökés', 'sziklamászás', 'síugrás', 'póker/e-sport', 'motorsport'],
      },
    },
  },

  /* ================================================================ 18 - NEW */
  {
    ordinal: '18',
    code: 'PROTOCOL',
    title: 'PROTOCOL',
    subtitle: 'Eljárásrendi fegyelem és ellenőrzőlista',
    version: '0.1.0',
    status: 'active',
    duration: 540,
    supports: ['vr', 'desktop', 'mobile'],
    assessmentMode: true,
    challengeMode: false,
    assetLoad: 1,
    codeLoad: 3,
    hue: 165,
    summary:
      'Többlépéses eljárás pontos, helyes sorrendű végrehajtása időnyomás, megszakítás és menet ' +
      'közbeni módosítás mellett. A fő mutató a kihagyott lépések száma.',
    paradigms: ['Checklist compliance', 'Prospective memory', 'Interruption recovery'],
    constructs: [
      { id: 'procedural_compliance', label: 'Eljáráskövetés' },
      { id: 'prospective_memory', label: 'Prospektív memória' },
      { id: 'interruption_recovery', label: 'Megszakítás utáni helyreállás' },
      { id: 'rule_retention', label: 'Szabálymegtartás' },
      { id: 'sequence_memory', label: 'Sorrendmemória', catalogRef: 88 },
    ],
    headlineMetrics: ['omitted_steps', 'order_errors', 'resumption_lag', 'compliance_under_pressure'],
    domains: {
      A: {
        relevance: S,
        headline: 'Eljárásrendi fegyelem',
        rationale: 'Fegyverellenőrzés, rádióeljárás, ellenőrzőpont-protokoll pontos végrehajtása.',
        examples: ['fegyverkezelés', 'híradó eljárás', 'ellenőrzőpont'],
      },
      B: {
        relevance: P,
        headline: 'Protokollkövetés megszakítások közben',
        rationale:
          'Repülési és egészségügyi eljárásokban is kockázatot jelenthet a megszakítás után kihagyott ' +
          'lépés. A modul ennek feladaton belüli előfordulását méri, nem az elméleti tudást.',
        examples: ['pilóta', 'ápoló', 'gyógyszerész', 'vegyipari operátor', 'laborvezető'],
      },
      C: {
        relevance: N,
        rationale: 'Sportban a bemelegítési és versenyrutin-fegyelem közvetetten érintett, alapból nem jelenítjük meg.',
      },
    },
  },

  /* ================================================================ 19 - NEW */
  {
    ordinal: '19',
    code: 'INTENT',
    title: 'INTENT',
    subtitle: 'Mozgásolvasás és szándékfelismerés',
    version: '0.1.0',
    status: 'active',
    duration: 420,
    supports: ['vr', 'desktop', 'mobile'],
    assessmentMode: true,
    challengeMode: true,
    assetLoad: 2,
    codeLoad: 3,
    hue: 285,
    summary:
      'Egy fénypontokból álló alak mozdulatot kezd, majd eltűnik. A feladat a mozgás irányának ' +
      'előrejelzése, megtévesztő mozdulatok mellett is.',
    paradigms: ['Biological motion / point-light displays', 'Temporal occlusion of opponent action', 'Deception detection'],
    constructs: [
      { id: 'biological_motion_perception', label: 'Biológiai mozgás észlelése' },
      { id: 'action_anticipation', label: 'Cselekvés-előrejelzés' },
      { id: 'deception_detection', label: 'Megtévesztés felismerése' },
      { id: 'kinematic_cue_use', label: 'Kinematikai jelzések használata' },
      { id: 'situational_judgement', label: 'Helyzetértékelés', catalogRef: 41 },
    ],
    headlineMetrics: ['prediction_accuracy', 'earliest_reliable_frame_ms', 'deception_susceptibility', 'confidence_calibration'],
    domains: {
      A: {
        relevance: S,
        headline: 'Szándékfelismerés testtartásból',
        rationale: 'Ellenőrzőponton és tömegben a fenyegető szándék korai kinematikai jelei.',
        examples: ['ellenőrzőpont-szolgálat', 'személyvédelem', 'rendészet'],
      },
      B: {
        relevance: S,
        headline: 'Gyalogos-szándék előrejelzése',
        rationale: 'Vezetés közben a gyalogos lelépési szándékának korai felismerése.',
        examples: ['hivatásos sofőr', 'biztonsági szolgálat'],
      },
      C: {
        relevance: P,
        headline: 'Ellenfélolvasás',
        rationale:
          'A feladat azt méri, milyen korán és pontosan olvasható ki az ellenfél mozdulatának iránya a ' +
          'látható kinematikai jelekből.',
        examples: ['kapus', 'vívás', 'tenisz', 'küzdősportok', 'kosárlabda-védekezés'],
      },
    },
  },
];

/* ------------------------------------------------------------------ */

export const MODULE_BY_CODE: Record<string, ModuleManifest> = Object.fromEntries(
  MODULES.map((m) => [m.code, m])
);

/** Modules visible in a domain, primary first, then by ordinal. */
export function modulesForDomain(domain: DomainCode): ModuleManifest[] {
  const rank = (r: Relevance) => (r === 'primary' ? 0 : r === 'secondary' ? 1 : 2);
  return MODULES.filter((m) => m.domains[domain].relevance !== 'none').sort((a, b) => {
    const d = rank(a.domains[domain].relevance) - rank(b.domains[domain].relevance);
    if (d !== 0) return d;
    // Runnable modules float to the top of their relevance band.
    const sa = a.status === 'active' ? 0 : a.status === 'external' ? 1 : 2;
    const sb = b.status === 'active' ? 0 : b.status === 'external' ? 1 : 2;
    if (sa !== sb) return sa - sb;
    return a.ordinal.localeCompare(b.ordinal);
  });
}

export function isRunnable(m: ModuleManifest): boolean {
  return m.status === 'active' || m.status === 'external';
}

/**
 * Whether the module itself can run on this platform, ignoring variants.
 *
 * `isRunnable` only asks whether the code exists. A module like STEADY, whose
 * measurement IS the headset's 6DoF trace, is implemented and still cannot run
 * on a laptop - and being told that on the card is better than starting it and
 * producing a run full of nulls.
 */
export function supportsPlatform(m: ModuleManifest, platform: PlatformMode): boolean {
  return m.status === 'external' || m.supports.includes(platform);
}

/** Runnable here and now: implemented, and supported on this platform. */
export function isRunnableOn(m: ModuleManifest, platform: PlatformMode): boolean {
  return isRunnable(m) && supportsPlatform(m, platform);
}

/** The variant a module should run when the caller did not choose one. */
export function defaultVariant(m: ModuleManifest): ModuleVariant | null {
  return m.variants?.[0] ?? null;
}

export function variantOf(m: ModuleManifest, id: string | undefined): ModuleVariant | null {
  if (!m.variants) return null;
  return m.variants.find((v) => v.id === id) ?? m.variants[0] ?? null;
}

/**
 * The config version a run should record. Two variants of the same module are
 * different tasks, so this string is what keeps their results out of each
 * other's norm group, leaderboard and personal best.
 */
export function configVersionFor(m: ModuleManifest, variantId?: string): string {
  const v = variantOf(m, variantId);
  return v ? v.configVersion : `${m.code}_STANDARD_A`;
}

/** Variants this platform can actually run. */
export function runnableVariants(m: ModuleManifest, platform: PlatformMode): ModuleVariant[] {
  return (m.variants ?? []).filter((v) => v.status === 'active' && v.supports.includes(platform));
}
