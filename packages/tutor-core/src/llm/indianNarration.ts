import { boardRowY } from "./systemPrompt";
import { INDIAN_LANGUAGE_OPTIONS, type TutorAudioLanguage } from "../tts/voiceLanguage";

export type RegionalNarrationLanguage = Exclude<TutorAudioLanguage, "english" | "hinglish">;

/** Runtime grammar only. Dynamic subject names, symbols and board rows stay English. */
interface NarrationPhrases {
  opening: string;
  given: string;
  and: string;
  here: string;
  question: string;
  setup: string;
  next: string;
  ready: string;
  labels: string;
  directions: string;
  wait: string;
  example: string;
  colour: string;
  key: string;
}

export const REGIONAL_NARRATION: Record<RegionalNarrationLanguage, NarrationPhrases> = {
  bengali: {
    opening: "ঠিক আছে, এই প্রশ্নটা ধাপে ধাপে বুঝে নিই.",
    given: "দেওয়া আছে", and: "এবং", here: "এখানে আছে", question: "প্রশ্নটা হলো",
    setup: "প্রথমে এই figure-এর setup দেখি.", next: "এবার figure-এর পরের অংশ দেখি.",
    ready: "এবার পুরো setup তৈরি.", labels: "এই labels দিয়ে figure-এর অংশগুলো চেনা যায়:",
    directions: "এবার এই figure-এর directions দেখি.", wait: "ভালো প্রশ্ন. একটু সময় দাও.",
    example: "এবার এই worked example বুঝে নিই.", colour: "এবার এতে colour যোগ করি.",
    key: "পাশের key প্রতিটি number-এর অংশের নাম বলে.",
  },
  gujarati: {
    opening: "ઠીક છે, આ પ્રશ્નને એક એક પગલે સમજીએ.",
    given: "આપેલું છે", and: "અને", here: "અહીં છે", question: "પ્રશ્ન આ છે",
    setup: "પહેલાં આ figure નો setup જોઈએ.", next: "હવે figure નો આગળનો ભાગ જોઈએ.",
    ready: "હવે આખો setup તૈયાર છે.", labels: "આ labels થી figure ના ભાગો ઓળખીએ:",
    directions: "હવે આ figure ની directions જોઈએ.", wait: "સારો પ્રશ્ન છે. એક ક્ષણ આપો.",
    example: "હવે આ worked example સમજીએ.", colour: "હવે તેમાં colour ઉમેરીએ.",
    key: "બાજુની key દરેક number વાળા ભાગનું નામ બતાવે છે.",
  },
  kannada: {
    opening: "ಸರಿ, ಈ ಪ್ರಶ್ನೆಯನ್ನು ಹಂತ ಹಂತವಾಗಿ ಅರ್ಥಮಾಡಿಕೊಳ್ಳೋಣ.",
    given: "ಕೊಟ್ಟಿರುವುದು", and: "ಮತ್ತು", here: "ಇಲ್ಲಿ ಇವೆ", question: "ಪ್ರಶ್ನೆ ಹೀಗಿದೆ",
    setup: "ಮೊದಲು ಈ figure ನ setup ನೋಡೋಣ.", next: "ಈಗ figure ನ ಮುಂದಿನ ಭಾಗ ನೋಡೋಣ.",
    ready: "ಈಗ ಸಂಪೂರ್ಣ setup ಸಿದ್ಧವಾಗಿದೆ.", labels: "ಈ labels ಮೂಲಕ figure ನ ಭಾಗಗಳನ್ನು ಗುರುತಿಸೋಣ:",
    directions: "ಈಗ ಈ figure ನ directions ನೋಡೋಣ.", wait: "ಒಳ್ಳೆಯ ಪ್ರಶ್ನೆ. ಒಂದು ಕ್ಷಣ ಕೊಡಿ.",
    example: "ಈಗ ಈ worked example ಅರ್ಥಮಾಡಿಕೊಳ್ಳೋಣ.", colour: "ಈಗ ಇದಕ್ಕೆ colour ಸೇರಿಸೋಣ.",
    key: "ಪಕ್ಕದಲ್ಲಿರುವ key ಪ್ರತಿ number ಇರುವ ಭಾಗದ ಹೆಸರು ತಿಳಿಸುತ್ತದೆ.",
  },
  malayalam: {
    opening: "ശരി, ഈ ചോദ്യം ഓരോ ഘട്ടമായി മനസ്സിലാക്കാം.",
    given: "തന്നിരിക്കുന്നത്", and: "കൂടാതെ", here: "ഇവിടെ ഉള്ളത്", question: "ചോദ്യം ഇതാണ്",
    setup: "ആദ്യം ഈ figure ന്റെ setup നോക്കാം.", next: "ഇനി figure ന്റെ അടുത്ത ഭാഗം നോക്കാം.",
    ready: "ഇപ്പോൾ മുഴുവൻ setup തയ്യാറായി.", labels: "ഈ labels ഉപയോഗിച്ച് figure ന്റെ ഭാഗങ്ങൾ തിരിച്ചറിയാം:",
    directions: "ഇനി ഈ figure ന്റെ directions നോക്കാം.", wait: "നല്ല ചോദ്യം. ഒരു നിമിഷം തരൂ.",
    example: "ഇനി ഈ worked example മനസ്സിലാക്കാം.", colour: "ഇനി ഇതിൽ colour ചേർക്കാം.",
    key: "അരികിലുള്ള key ഓരോ number ഉള്ള ഭാഗത്തിന്റെ പേര് പറയുന്നു.",
  },
  marathi: {
    opening: "ठीक आहे, हा प्रश्न टप्प्याटप्प्याने समजून घेऊया.",
    given: "दिले आहे", and: "आणि", here: "इथे आहेत", question: "प्रश्न असा आहे",
    setup: "आधी या figure चा setup पाहूया.", next: "आता figure चा पुढचा भाग पाहूया.",
    ready: "आता संपूर्ण setup तयार आहे.", labels: "या labels वरून figure चे भाग ओळखूया:",
    directions: "आता या figure मधल्या directions पाहूया.", wait: "चांगला प्रश्न आहे. एक क्षण थांब.",
    example: "आता हे worked example समजून घेऊया.", colour: "आता यात colour भरूया.",
    key: "बाजूची key प्रत्येक number असलेल्या भागाचे नाव सांगते.",
  },
  odia: {
    opening: "ଠିକ୍ ଅଛି, ଏହି ପ୍ରଶ୍ନକୁ ଗୋଟିଏ ଗୋଟିଏ ପଦକ୍ଷେପରେ ବୁଝିବା.",
    given: "ଦିଆଯାଇଛି", and: "ଏବଂ", here: "ଏଠାରେ ଅଛି", question: "ପ୍ରଶ୍ନଟି ହେଉଛି",
    setup: "ପ୍ରଥମେ ଏହି figure ର setup ଦେଖିବା.", next: "ଏବେ figure ର ପରବର୍ତ୍ତୀ ଅଂଶ ଦେଖିବା.",
    ready: "ଏବେ ସମ୍ପୂର୍ଣ୍ଣ setup ପ୍ରସ୍ତୁତ.", labels: "ଏହି labels ରୁ figure ର ଅଂଶଗୁଡ଼ିକ ଚିହ୍ନିବା:",
    directions: "ଏବେ ଏହି figure ର directions ଦେଖିବା.", wait: "ଭଲ ପ୍ରଶ୍ନ. ଟିକେ ସମୟ ଦିଅ.",
    example: "ଏବେ ଏହି worked example ବୁଝିବା.", colour: "ଏବେ ଏଥିରେ colour ଯୋଡ଼ିବା.",
    key: "ପାଖରେ ଥିବା key ପ୍ରତ୍ୟେକ number ଥିବା ଅଂଶର ନାମ କହେ.",
  },
  punjabi: {
    opening: "ਠੀਕ ਹੈ, ਇਸ ਸਵਾਲ ਨੂੰ ਇੱਕ ਇੱਕ ਕਦਮ ਨਾਲ ਸਮਝਦੇ ਹਾਂ.",
    given: "ਦਿੱਤਾ ਹੋਇਆ ਹੈ", and: "ਅਤੇ", here: "ਇੱਥੇ ਹਨ", question: "ਸਵਾਲ ਇਹ ਹੈ",
    setup: "ਪਹਿਲਾਂ ਇਸ figure ਦਾ setup ਦੇਖਦੇ ਹਾਂ.", next: "ਹੁਣ figure ਦਾ ਅਗਲਾ ਹਿੱਸਾ ਦੇਖਦੇ ਹਾਂ.",
    ready: "ਹੁਣ ਪੂਰਾ setup ਤਿਆਰ ਹੈ.", labels: "ਇਹਨਾਂ labels ਨਾਲ figure ਦੇ ਹਿੱਸੇ ਪਛਾਣਦੇ ਹਾਂ:",
    directions: "ਹੁਣ ਇਸ figure ਦੀਆਂ directions ਦੇਖਦੇ ਹਾਂ.", wait: "ਵਧੀਆ ਸਵਾਲ ਹੈ. ਇੱਕ ਪਲ ਦਿਓ.",
    example: "ਹੁਣ ਇਹ worked example ਸਮਝਦੇ ਹਾਂ.", colour: "ਹੁਣ ਇਸ ਵਿੱਚ colour ਭਰਦੇ ਹਾਂ.",
    key: "ਨਾਲ ਦਿੱਤੀ key ਹਰ number ਵਾਲੇ ਹਿੱਸੇ ਦਾ ਨਾਮ ਦੱਸਦੀ ਹੈ.",
  },
  tamil: {
    opening: "சரி, இந்தக் கேள்வியை படிப்படியாகப் புரிந்துகொள்வோம்.",
    given: "கொடுக்கப்பட்டுள்ளது", and: "மற்றும்", here: "இங்கே இருப்பவை", question: "கேள்வி இதுதான்",
    setup: "முதலில் இந்த figure இன் setup ஐப் பார்ப்போம்.", next: "இப்போது figure இன் அடுத்த பகுதியைப் பார்ப்போம்.",
    ready: "இப்போது முழு setup தயாராக உள்ளது.", labels: "இந்த labels மூலம் figure இன் பகுதிகளை அடையாளம் காணலாம்:",
    directions: "இப்போது இந்த figure இன் directions ஐப் பார்ப்போம்.", wait: "நல்ல கேள்வி. ஒரு நிமிடம் கொடு.",
    example: "இப்போது இந்த worked example ஐப் புரிந்துகொள்வோம்.", colour: "இப்போது இதில் colour சேர்ப்போம்.",
    key: "பக்கத்தில் உள்ள key ஒவ்வொரு number உள்ள பகுதியின் பெயரைச் சொல்கிறது.",
  },
  telugu: {
    opening: "సరే, ఈ ప్రశ్నను ఒక్కో దశగా అర్థం చేసుకుందాం.",
    given: "ఇచ్చినవి", and: "మరియు", here: "ఇక్కడ ఉన్నవి", question: "ప్రశ్న ఇది",
    setup: "ముందుగా ఈ figure యొక్క setup చూద్దాం.", next: "ఇప్పుడు figure యొక్క తరువాతి భాగం చూద్దాం.",
    ready: "ఇప్పుడు పూర్తి setup సిద్ధంగా ఉంది.", labels: "ఈ labels ద్వారా figure లోని భాగాలను గుర్తిద్దాం:",
    directions: "ఇప్పుడు ఈ figure లోని directions చూద్దాం.", wait: "మంచి ప్రశ్న. ఒక్క క్షణం ఆగు.",
    example: "ఇప్పుడు ఈ worked example అర్థం చేసుకుందాం.", colour: "ఇప్పుడు దీనికి colour జోడిద్దాం.",
    key: "పక్కన ఉన్న key ప్రతి number ఉన్న భాగం పేరు చెబుతుంది.",
  },
};

export function regionalNarration(language: TutorAudioLanguage | undefined): NarrationPhrases | undefined {
  return language && language !== "english" && language !== "hinglish"
    ? REGIONAL_NARRATION[language] : undefined;
}

const REGIONAL_SCRIPTS = INDIAN_LANGUAGE_OPTIONS.filter((option) => option.language !== "hinglish" && option.language !== "marathi")
  .map((option) => ({ language: option.language, pattern: new RegExp(`\\p{Script=${option.script === "Odia" ? "Oriya" : option.script}}`, "u") }));

/** Restore runtime figure cue words from recorded narration without changing old turn schemas. */
export function recordedNarrationLanguage(text: string): TutorAudioLanguage | undefined {
  for (const { language, pattern } of REGIONAL_SCRIPTS) if (pattern.test(text)) return language;
  // Hindi and Marathi share a script. Runtime Marathi phrases identify its
  // figure introductions; a legacy Devanagari intro retains the Hinglish path.
  if (Object.values(REGIONAL_NARRATION.marathi).some((phrase) => text.includes(phrase))) return "marathi";
  return /\p{Script=Devanagari}/u.test(text) ? "hinglish" : undefined;
}

export function regionalNarrationAddon(language: RegionalNarrationLanguage): string {
  const option = INDIAN_LANGUAGE_OPTIONS.find((item) => item.language === language)!;
  return `${option.label.toUpperCase()} NARRATION
The student hears this lesson in ${option.label}, with natural ${option.label} grammar around English subject terms and mathematics. This overrides every earlier instruction to speak English. It changes only narration; protocol tags, ids, coordinates and board writing keep their original meaning.
- Write ${option.label} words in ${option.script} script and English terms in Latin letters. Never romanize ${option.label} or transliterate English terms into the native script.
- Every sentence uses ${option.label} grammar; do not deliver the explanation in English or Hindi.
- Keep all [WRITE] rows, [EMPHASIZE] text and other tags in English. Never translate a board row, change a [FOCUS] id or invent diagram geometry.
- Say all mathematics and every number in English words: "x squared", "equals", "nine", "two point five", "meters per second". Never use native number words or native digits. The pen matches these English mathematics words to the board.
- Speak the new board row in English maths words inside the ${option.label} sentence, place its [WRITE] tag immediately after those words, then give the reason in ${option.label}. Keep subject terms such as force, velocity and substitute in English.
- Name a figure part by its existing English board label immediately before its [FOCUS] tag.
- End sentences with "." or "?". The runtime opening has already spoken; do not greet or open the lesson again.
Example:
[STEP]
x squared equals nine. [WRITE:x^2 = 9,90,${boardRowY(2)}] ${REGIONAL_NARRATION[language].here} x squared ${REGIONAL_NARRATION[language].and} nine.
[/STEP]`;
}
