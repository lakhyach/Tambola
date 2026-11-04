import { speakWord } from "./number-words.js";

/** Exact 24-line set from the approved Sarvam audition manifest. */
export const SARVAM_CALLOUTS = Object.freeze({
  en: Object.freeze({
    1: "Number one! The game woke up; even the chai sat up straight.",
    7: "Lucky seven! Oho, someone's ticket is smiling before the win.",
    11: "Double one! Two tiny soldiers just marched onto your ticket.",
    27: "Twenty-seven! Three nines formed a committee; snacks are on the agenda.",
    44: "Double four! The corners heard the news and asked for samosas.",
    55: "Double five! Bollywood luck has entered; keep those pencils in rhythm.",
    77: "Double seven! Lovely luck—keep the victory dance on standby!",
    90: "Ninety! The grand finale; uncle's standing, but the game's still going!",
  }),
  hindi: Object.freeze({
    1: "नंबर एक! खेल जागा तो चाय ने भी सीधा बैठकर ताली बजाई!",
    7: "नंबर सात! अरे वाह, आज तो किस्मत भी ठुमके लगा रही है!",
    11: "ग्यारह नंबर! दो छोटे सिपाही टिकट पर कदमताल कर रहे हैं!",
    27: "सत्ताईस नंबर! तीन नौ मिले, किस्मत की टोली बन गई!",
    44: "चवालीस नंबर! चारों कोने बोले—पहले टिकट देखो, फिर समोसा लो!",
    55: "पचपन नंबर! डबल पाँच आया, किस्मत भी फ़िल्मी अंदाज़ में!",
    77: "सतहत्तर नंबर! डबल सात, क्या बात—नाचना थोड़ा संभाल के!",
    90: "नब्बे नंबर! आख़िरी पुकार, मामा जी की टिकट जाँच अभी भी जारी!",
  }),
  hinglish: Object.freeze({
    1: "Number ek! Game jaag gaya, chai ne bhi seedha baith ke taali bajayi!",
    7: "Saat number! Arre wah, aaj toh kismat bhi thumke laga rahi hai!",
    11: "Gyarah number! Do chhote sipahi ticket par parade kar rahe hain!",
    27: "Sattais number! Teen nau mile, kismat ki team ban gayi!",
    44: "Chawalis number! Chaaron kone bole, pehle ticket dekho, phir samosa lo!",
    55: "Pachpan number! Double five aaya, luck bhi filmi andaaz mein!",
    77: "Satattar number! Double saat, kya baat—dance thoda sambhaal ke!",
    90: "Nabbe number! Final call, mama ji ki ticket checking abhi bhi jaari!",
  }),
});

/** One stable, original line for each official number. The Hindi voice copy
 * is conversational Romanized Hinglish, not a translation of the English joke. */
export const ENGLISH_CALLOUTS = Object.freeze([
  "Number one! The opener is in; even the chai has stopped gossiping.",
  "Two is here with a plus-one: the person who says ‘I nearly had it.’",
  "Three! Give those tickets a cheer; they have been waiting all afternoon.",
  "Four corners, one number, and someone still guarding the samosas.",
  "Five alive! High-five your ticket; it has done absolutely nothing yet.",
  "Six has arrived. The spreadsheet of luck is now under review.",
  "Seven! Lucky number, allegedly. Our legal team is a ticket holder.",
  "Eight is great; the aunties have begun a very serious eye-contact contest.",
  "Nine! A tiny number with the confidence of a wedding DJ.",
  "Ten! Perfect score for arriving; attendance is the only prize so far.",
  "Eleven! Two little soldiers marching past the snack table in formation.",
  "Twelve rounds the clock; the tea break has filed an extension request.",
  "Thirteen! The superstition committee has gone backstage to calm down.",
  "Fourteen has entered; one uncle has already called it ‘his number.’",
  "Fifteen! Your ticket says nothing, but its eyebrows say ‘I knew.’",
  "Sixteen candles, one ticket, and absolutely no birthday privileges.",
  "Seventeen! Arriving with the confidence of someone who checked twice.",
  "Eighteen! Old enough to cheer; still young enough to blame the caller.",
  "Nineteen is approaching twenty like it owes the room money.",
  "Twenty! A round number; the round of snacks is still being negotiated.",
  "Twenty-one! Please raise a hand if your ticket has suddenly become shy.",
  "Twenty-two: two ducks in a row, both refusing to mark your ticket.",
  "Twenty-three! Fan club seats are open; membership requires one ticket.",
  "Twenty-four hours in a day and somehow we booked the best one.",
  "Twenty-five! A silver quarter-century; please clap in installments.",
  "Twenty-six letters in the alphabet, and your ticket still says ‘maybe.’",
  "Twenty-seven! Three nines are forming a fan club; somebody call their manager!",
  "Twenty-eight! February called; it wants its calendar back.",
  "Twenty-nine is warming up a speech for thirty. The speech is longer than this game.",
  "Thirty! Your ticket is acting surprised; we can all see the rehearsal notes.",
  "Thirty-one: the month ends, the family group chat does not.",
  "Thirty-two teeth, zero bites taken until the caller finishes. Respect the snacks.",
  "Thirty-three! Triple applause requested; the budget allows one enthusiastic clap.",
  "Thirty-four says that lucky chair has earned a promotion and better cushions.",
  "Thirty-five! High-five the air; your neighbor's ticket is watching.",
  "Thirty-six degrees of suspense, and one fan pointed directly at the caller.",
  "Thirty-seven! Luck is in a meeting; focus has joined us on time.",
  "Thirty-eight brought a drumroll in carry-on luggage. Security says it is fine.",
  "Thirty-nine is rehearsing its entrance for forty; the spotlight is booked.",
  "Forty! The beat is here, the snacks are here, and the diet left quietly.",
  "Forty-one! The snack committee has formed a subcommittee. No decision yet.",
  "Forty-two: the answer to life, the universe, and ‘who took the last pakora?’",
  "Forty-three! Eyes on your ticket; the neighbor's dramatic gasp is not evidence.",
  "Forty-four! Double trouble has arrived. Hide your snacks and protect your tickets!",
  "Forty-five! Halfway to ninety; stand up if your knees have approved the plan.",
  "Forty-six entered without a plot twist. The room has requested a refund.",
  "Forty-seven! Your ticket is keeping a straight face; it learned from the uncle.",
  "Forty-eight: two dozen reasons to stay hopeful and one reason to refill chai.",
  "Forty-nine! The big five-oh is backstage asking if the mic is working.",
  "Fifty! Halfway through; even the samosas have settled in for the finale.",
  "Fifty-one! One past fifty and already asking for a bigger dressing room.",
  "Fifty-two shuffled in. The playing cards are demanding family recognition.",
  "Fifty-three! Lucky socks are under investigation; laundry is the prime suspect.",
  "Fifty-four says stay calm. The caller's checklist has a checklist.",
  "Fifty-five! Double five, double drama. Your luck is doing Bollywood today!",
  "Fifty-six! The ticket grid is accepting applause, compliments, and chai.",
  "Fifty-seven has a plan. The ticket has not been briefed.",
  "Fifty-eight! Sixty is nearby; guessing is still not a recognized strategy.",
  "Fifty-nine is taking the scenic route to sixty. Please enjoy the view.",
  "Sixty arrived with perfect posture; the rest of us blame the sofa.",
  "Sixty-one! The scoreboard is acting cool, but it absolutely refreshed twice.",
  "Sixty-two is two past sixty and still remembers to say please.",
  "Sixty-three brought its own tiny drumroll. The band is one person and a spoon.",
  "Sixty-four! A classic number; your ticket is pretending not to feel nostalgic.",
  "Sixty-five winked at the room. The room has asked for that in writing.",
  "Sixty-six! Double sixes; the lucky socks are taking full credit again.",
  "Sixty-seven arrived with no spoilers. Unlike that cousin near the board.",
  "Sixty-eight: suspense and a biscuit. Finally, a balanced evening.",
  "Sixty-nine is here; keep it family-friendly and keep your eyes on the ticket.",
  "Seventy! The number parade has reached the table where everyone brought glasses.",
  "Seventy-one asked if snacks are included. Finally, someone asks the real question.",
  "Seventy-two: three dozen numbers and one room pretending not to be competitive.",
  "Seventy-three says your ticket cannot bluff; it has no poker face.",
  "Seventy-four arrived wearing the caller's imaginary hat. It is slightly too big.",
  "Seventy-five! Three quarters of the way; the water bottle is now a trophy.",
  "Seventy-six: stay cool, check every row, and stop accusing the pen.",
  "Seventy-seven! Double sevens; please cheer like the neighbors are also playing.",
  "Seventy-eight is close to eighty; the finish line has put out a welcome mat.",
  "Seventy-nine says the finish line can wait. It has not filled the form yet.",
  "Eighty! The drum has entered legend mode; the spoon player is emotional.",
  "Eighty-one: nine times nine and dressed better than the caller tonight.",
  "Eighty-two! The final rows are watching; even the ticket has sat up straight.",
  "Eighty-three: one honest call at a time. The suspicious eyebrow is optional.",
  "Eighty-four is seven dozen and the reason someone just checked their ticket again.",
  "Eighty-five! The room is holding its breath; someone please tell the samosas.",
  "Eighty-six says cheer loudly, but don't let enthusiasm mark the wrong square.",
  "Eighty-seven! Nearly time to brag; practice a humble victory face now.",
  "Eighty-eight! Two snowmen arrived; the room has requested tiny scarves.",
  "Eighty-nine: the finish line is finally in the family group chat.",
  "Ninety! The grand finale of numbers. Even your uncle is standing up!",
]);

export const HINGLISH_CALLOUTS = Object.freeze([
  "Arre chai ki pyaali bhi bol padi: pehle meri attendance lagao!",
  "Do samose ne teesre ko waiting list par daal diya.",
  "Teen auto waale ek hi passenger ko VIP bol rahe hain.",
  "Chaar baje ki neend ne meeting invite bheja hai.",
  "Paanch rupaye ka coin sofa ke neeche secret agent bana baitha hai.",
  "Chhe seeti ke baad pressure cooker ne resignation de diya.",
  "Saatvi ball par bowler ne pep talk diya; wicket boli, pehle ticket toh dekh!",
  "Aath baje ka alarm kal se hi emotional support maang raha hai.",
  "Nau percent battery par phone ne survival mode announce kiya.",
  "Das dabbon ka tiffin ho, par chammach hamesha missing.",
  "Gyarah log selfie mein aa gaye; photographer abhi bhi apna phone dhoondh raha.",
  "Baarah parathe dekh kar gym membership ne aankh band kar li.",
  "Terahvi chai ke baad cup ne khud ko staff member samajh liya.",
  "Chaudah unread messages, aur sab mein sirf 'kahan ho?'.",
  "Pandrah minute ki nap ka sequel seedha shaam ko aata hai.",
  "Solah baar remote dabaya; TV ne phir bhi apni marzi chalaayi.",
  "Satrah ka scooter start hua toh padosi ne taali baja di.",
  "Atharah golgappe ke baad bhi 'bas ek aur' ka iraada zinda hai.",
  "Unnees ki chappal ghar mein hai, doosri abhi adventure par hai.",
  "Bees par chai thandi hui; biscuit ne turant doobki laga di.",
  "Ikkis photos ke baad bhi family ko wahi pehli wali pasand aayi.",
  "Bais ka traffic signal green hua, par sabne meeting continue rakhi.",
  "Teis minute se lift aa rahi hai; button ko hausla chahiye.",
  "Chaubis ghante ka din aur list mein kaam chhabis ghante ka.",
  "Pachis rupaye bachane ke chakkar mein delivery double door se aayi.",
  "Chhabis par bacche ne homework ko 'creative interpretation' bol diya.",
  "Sattais tareekh ko budget ne calendar se kaha: aaj hum ek-doosre ko nahi jaante.",
  "Atthais kadam chala; smartwatch ne marathon ka medal bhej diya.",
  "Unatis wala joke suna, par hansi sirf speaker ko aayi.",
  "Tees ki dhoop mein chhatri ne picnic mode chalu kar diya.",
  "Iktis din baad bhi fridge mein wahi mystery dabba milta hai.",
  "Battis daant hain, par mirchi aate hi meeting cancel.",
  "Taintis rupees ka change dukandaar aur customer dono dhoondh rahe.",
  "Chauntis ke baad calendar ne bola: ab thoda weekend bhejo.",
  "Paintis minute ka recipe video; asli cooking abhi shuru hui.",
  "Chhattis ka fan hawa kam, purani yaadein zyada suna raha.",
  "Saintis baar password socha; notebook ko promotion mil gaya.",
  "Adtees ki baarish mein balcony ka kapda Olympic swimmer nikla.",
  "Untalis ki queue mein sabse aage token machine khud khadi thi.",
  "Chalis par chai ka break; biscuit ne minutes badha diye.",
  "Iktalis tabs khule hain, par gaana wahi ek chal raha.",
  "Bayalis ka lunch dabba khula aur office ka mood turant badla.",
  "Taintalis minute ka traffic; gaadi mein antakshari championship chal rahi.",
  "Chawalis ka phone silent tha; ghar waalon ne phir bhi usko teen baar call kiya.",
  "Paintalis rupaye ka coupon mila; shopping list ne nayi life paayi.",
  "Chhiyalis ke baad kambal ne officially ghar ka lease le liya.",
  "Saintalis ki chhat par kabootar ne morning meeting bula li.",
  "Adtalis ka birthday cake; candles ne fire drill maang li.",
  "Unchas se pehle hi chai waale bhaiya ne order yaad kar liya.",
  "Pachas ke baad smartwatch ne steps ko personal favour samjha.",
  "Ikyavan ka plant ab ghar ka sabse zimmedaar member hai.",
  "Bavan ka ringtone suna; teen logon ne apna phone check kiya.",
  "Tirpan ki flight mein khidki seat mili, cloud ne selfie maangi.",
  "Chauvan par fridge khola; andar se sirf roshni ne hello kaha.",
  "Pachpan minute se parcel raaste mein hai; map par woh chhutti mana raha.",
  "Chhappan ke baad bhi remote ka asli owner sofa hi hota hai.",
  "Sattavan ka selfie angle mila, ab poora ghar photographer hai.",
  "Athavan ka charger ghar mein sabka, par milta kisi ko nahi.",
  "Unsath ke baad shopping cart ko bhi thoda rest chahiye.",
  "Saath par colony ke kutte ne apna morning concert shuru kiya.",
  "Iksath ka lunch salad tha; doston ne sympathy mein fries baante.",
  "Basath ka mixer chala toh padosi ko weather update mil gaya.",
  "Tirsath ka suitcase band hua; socks ne bahar se bye bola.",
  "Chaunsath par chai mein adrak itni thi, cup ne salute kiya.",
  "Painsath ka plant paani maangta; owner weather app check karta.",
  "Chhiyasath ka school group abhi bhi good morning bhej raha.",
  "Sadsath par barfi aayi, diet plan ne chhutti le li.",
  "Adsath ka keyboard type karte hi chai break suggest karta.",
  "Unhattar ka dupatta hawa mein gaya; balcony ne fashion show kiya.",
  "Sattar par family group ne ek aur blurry photo forward ki.",
  "Ikhattar ki lift mein sab floor button ko diplomatic space de rahe.",
  "Bahattar ka dosa itna crisp tha, padosi ne sound check kiya.",
  "Tihattar ke shoes naye hain; chalne se pehle photo session hua.",
  "Chauhattar ka calendar dekh kar Monday ne disguise pehen liya.",
  "Pachhattar ki train chali; platform par chai ne wave kiya.",
  "Chhihattar par fridge magnet ne holiday postcard bheja.",
  "Satattar ka dance step dekha; sofa ne khud safety distance bana liya.",
  "Athhattar ke baad biscuit ka packet bina awaaz khul hi nahi sakta.",
  "Unasi ka umbrella ghar par; baarish ne location share kar di.",
  "Assi ke baad bhi nani ka snack dabba kabhi khaali nahi hota.",
  "Ikyasi par inbox saaf kiya; naye emails ne welcome party di.",
  "Bayasi ke baad pillow ne 'five more minutes' ka contract diya.",
  "Tirasi ka haircut dekh kar mirror ne double take liya.",
  "Chaurasi mein family recipe ka secret ingredient: andaaza hi hai.",
  "Pachasi ki bus mein seat mili; bag ne pehle jagah reserve ki.",
  "Chhiyasi par fridge ka leftover ab chef special kehlayega.",
  "Sattasi ki baar chai refill hui; cup ne retirement postpone ki.",
  "Athasi par mobile update aaya; restart ka plan kal banega.",
  "Navasi ki shaadi mein dhol baja; chappal ne dance floor pakda.",
  "Nabbe par mithai ka dabba khula; diet boli, main agle round se join karungi.",
]);

export const NUMBER_CALLOUT_COUNT = 90;
export const CALLER_FESTIVALS = Object.freeze([
  "classic", "diwali", "holi", "navratri", "durga_puja", "ganesh_chaturthi",
  "onam", "pongal", "eid", "christmas", "halloween", "wedding", "royal", "neon", "textile",
]);

const FESTIVAL_TAGS = Object.freeze({
  diwali: ["Festival lights are on.", "Tyohar ki roshni full power par hai."],
  holi: ["A little colour for the lucky moment.", "Kismat ke moment mein thoda sa rang."],
  navratri: ["The dandiya beat is optional.", "Dandiya ka beat optional hai."],
  durga_puja: ["The celebration committee approves.", "Utsav committee ne haan bol diya."],
  ganesh_chaturthi: ["The festive mood has joined in.", "Tyohar ka mood bhi saath aa gaya."],
  onam: ["The whole hall gets a festive flourish.", "Poore hall ko festive touch mil gaya."],
  pongal: ["Good luck is simmering nicely.", "Kismat ki khichdi mast pak rahi hai."],
  eid: ["Warm wishes and one more reason to smile.", "Dil se wishes, muskurane ka ek aur reason."],
  christmas: ["A little surprise for the room.", "Room ke liye ek chhota surprise."],
  halloween: ["No tricks on the ticket, promise.", "Ticket par koi trick nahi, pakka."],
  wedding: ["The table is invited to celebrate.", "Saari table celebration mein invited hai."],
  royal: ["A royal flourish for this lucky hall.", "Lucky hall ke liye royal entry."],
  neon: ["Bright lights, sharper eyes.", "Lights bright, nazar aur sharp."],
  textile: ["One more colourful thread in the pattern.", "Pattern mein ek aur colourful dhaaga."],
});

export function getNumberCallout(number, { language = "en", festival = "classic" } = {}) {
  if (!Number.isInteger(number) || number < 1 || number > NUMBER_CALLOUT_COUNT) return "";
  const selected = language === "hi" || language === "hinglish" ? "hinglish" : language;
  const exact = SARVAM_CALLOUTS[selected]?.[number];
  if (exact) return exact;
  const index = number - 1;
  const lang = selected === "hi" || selected === "hinglish" ? 1 : 0;
  const line = lang ? HINGLISH_CALLOUTS[index] : ENGLISH_CALLOUTS[index];
  const theme = String(festival || "classic").toLowerCase().replace(/[\s-]+/g, "_");
  const tag = FESTIVAL_TAGS[theme]?.[lang];
  return tag ? line + " " + tag : line;
}

/** Number first, then its language-matched joke. Numbers always come from the
 * authoritative call event; this function has no draw or selection logic. */
export function buildNumberAnnouncement(number, options = {}) {
  const language = options.language === "hindi" ? "hindi" : (options.language === "hinglish" || options.language === "hi") ? "hinglish" : "en";
  const exact = options.includeCallout === false ? "" : SARVAM_CALLOUTS[language]?.[number];
  if (exact) return exact;
  const spokenNumber = speakWord(number, language === "en" ? "en" : "hi");
  if (!options.includeCallout) return spokenNumber;
  if (language === "hindi") return String(number);
  const line = getNumberCallout(number, { ...options, language });
  const intro = spokenNumber + "!";
  if (!line) return spokenNumber;
  // Some energetic English callouts announce their own number. Remove that
  // opening echo so the official number is spoken once, clearly, before the
  // punchline. Contextual mentions later in the joke are left untouched.
  if (language === "en") {
    const numberPattern = spokenNumber.split("-").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[ -]");
    const hasNumberPrefix = new RegExp(`^(?:number\\s+)?${numberPattern}(?:\\b|\\s)`, "i").test(line);
    return hasNumberPrefix ? line : `${spokenNumber}! ${line}`;
  }
  const numberPattern = spokenNumber.split("-").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[ -]");
  const hasNumberPrefix = new RegExp(`^${numberPattern}(?:\\b|\\s)`, "i").test(line);
  return hasNumberPrefix ? line : intro + " " + line;
}
