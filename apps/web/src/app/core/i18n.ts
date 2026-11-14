import { Injectable, signal } from '@angular/core';

export interface LanguageChoice {
  id: string;
  native: string;
  name: string;
}

export const LANGUAGES: LanguageChoice[] = [
  { id: 'en', native: 'English', name: 'English' },
  { id: 'hi', native: 'हिन्दी', name: 'Hindi' },
  { id: 'kn', native: 'ಕನ್ನಡ', name: 'Kannada' },
  { id: 'ta', native: 'தமிழ்', name: 'Tamil' },
  { id: 'gu', native: 'ગુજરાતી', name: 'Gujarati' },
  { id: 'bn', native: 'বাংলা', name: 'Bengali' },
  { id: 'ar', native: 'العربية', name: 'Arabic' },
  { id: 'es', native: 'Español', name: 'Spanish' },
  { id: 'fr', native: 'Français', name: 'French' },
  { id: 'he', native: 'עברית', name: 'Hebrew' },
];

const KEY = 'altamid_hrms_lang';

const packs: Record<string, Record<string, string>> = {
  hi: {
    'My day': 'मेरा दिन', Home: 'होम', Attendance: 'हाजिरी', Exceptions: 'अपवाद', Leave: 'छुट्टी', Announcements: 'घोषणाएँ', Requests: 'अनुरोध', Recognition: 'सम्मान', Jobs: 'नौकरियाँ', Library: 'पुस्तकालय', 'My pay': 'मेरा वेतन', 'My team': 'मेरी टीम', Approvals: 'स्वीकृतियाँ', Company: 'कंपनी', People: 'लोग', Hiring: 'भर्ती', Organisation: 'संगठन', Payroll: 'पेरोल', Settings: 'सेटिंग्स',
    'Search anything in HRMS...': 'HRMS में कुछ भी खोजें...', 'Nothing matches that search.': 'इस खोज से कुछ नहीं मिला।', Notifications: 'सूचनाएँ', 'Mark all read': 'सब पढ़ा हुआ', 'View all': 'सभी देखें', 'No notifications': 'कोई सूचना नहीं', Expand: 'खोलें', Collapse: 'समेटें', Language: 'भाषा', All: 'सभी', Waiting: 'प्रतीक्षा', News: 'समाचार', Badges: 'बैज', 'No pending actions exist for you.': 'आपके लिए कोई लंबित कार्य नहीं है।',
    'Back to people': 'लोगों पर वापस', Joined: 'शामिल हुए', 'Total service': 'कुल सेवा', Manager: 'प्रबंधक', Status: 'स्थिति', Personal: 'व्यक्तिगत', Contact: 'संपर्क', 'Date of birth': 'जन्म तिथि', Gender: 'लिंग', 'Marital status': 'वैवाहिक स्थिति', Nationality: 'राष्ट्रीयता', 'Blood group': 'रक्त समूह', Confirmed: 'पुष्टि', 'Emergency contact': 'आपातकालीन संपर्क', 'Emergency phone': 'आपातकालीन फ़ोन', Address: 'पता', 'Not added': 'जोड़ा नहीं', 'Your details': 'आपका विवरण', Save: 'सहेजें', Email: 'ईमेल', Phone: 'फ़ोन', Location: 'स्थान', Worker: 'कर्मचारी प्रकार',
  },
  kn: {
    'My day': 'ನನ್ನ ದಿನ', Home: 'ಮುಖಪುಟ', Attendance: 'ಹಾಜರಾತಿ', Exceptions: 'ವಿನಾಯಿತಿಗಳು', Leave: 'ರಜೆ', Announcements: 'ಪ್ರಕಟಣೆಗಳು', Requests: 'ವಿನಂತಿಗಳು', Recognition: 'ಗೌರವ', Jobs: 'ಉದ್ಯೋಗಗಳು', Library: 'ಗ್ರಂಥಾಲಯ', 'My pay': 'ನನ್ನ ವೇತನ', 'My team': 'ನನ್ನ ತಂಡ', Approvals: 'ಅನುಮೋದನೆಗಳು', Company: 'ಕಂಪನಿ', People: 'ಜನರು', Hiring: 'ನೇಮಕಾತಿ', Organisation: 'ಸಂಸ್ಥೆ', Payroll: 'ವೇತನ', Settings: 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು',
    'Search anything in HRMS...': 'HRMS ನಲ್ಲಿ ಹುಡುಕಿ...', 'Nothing matches that search.': 'ಹೊಂದಾಣಿಕೆ ಇಲ್ಲ.', Notifications: 'ಅಧಿಸೂಚನೆಗಳು', 'Mark all read': 'ಎಲ್ಲವನ್ನೂ ಓದಿದೆ', 'View all': 'ಎಲ್ಲವನ್ನೂ ನೋಡಿ', 'No notifications': 'ಅಧಿಸೂಚನೆಗಳಿಲ್ಲ', Expand: 'ವಿಸ್ತರಿಸಿ', Collapse: 'ಮುಚ್ಚಿ', Language: 'ಭಾಷೆ', All: 'ಎಲ್ಲಾ', Waiting: 'ಕಾಯುವಿಕೆ', News: 'ಸುದ್ದಿ', Badges: 'ಬ್ಯಾಡ್ಜ್', 'No pending actions exist for you.': 'ನಿಮಗೆ ಯಾವುದೇ ಬಾಕಿ ಕೆಲಸವಿಲ್ಲ.',
    'Back to people': 'ಜನರ ಬಳಿಗೆ', Joined: 'ಸೇರಿದ ದಿನ', 'Total service': 'ಒಟ್ಟು ಸೇವೆ', Manager: 'ವ್ಯವಸ್ಥಾಪಕ', Status: 'ಸ್ಥಿತಿ', Personal: 'ವೈಯಕ್ತಿಕ', Contact: 'ಸಂಪರ್ಕ', 'Date of birth': 'ಹುಟ್ಟಿದ ದಿನಾಂಕ', Gender: 'ಲಿಂಗ', 'Marital status': 'ವೈವಾಹಿಕ ಸ್ಥಿತಿ', Nationality: 'ರಾಷ್ಟ್ರೀಯತೆ', 'Blood group': 'ರಕ್ತದ ಗುಂಪು', Confirmed: 'ದೃಢೀಕರಣ', 'Emergency contact': 'ತುರ್ತು ಸಂಪರ್ಕ', 'Emergency phone': 'ತುರ್ತು ಫೋನ್', Address: 'ವಿಳಾಸ', 'Not added': 'ಸೇರಿಸಿಲ್ಲ', 'Your details': 'ನಿಮ್ಮ ವಿವರ', Save: 'ಉಳಿಸಿ', Email: 'ಇಮೇಲ್', Phone: 'ಫೋನ್', Location: 'ಸ್ಥಳ', Worker: 'ಕಾರ್ಮಿಕ ಪ್ರಕಾರ',
  },
  ta: {
    'My day': 'என் நாள்', Home: 'முகப்பு', Attendance: 'வருகை', Exceptions: 'விதிவிலக்குகள்', Leave: 'விடுப்பு', Announcements: 'அறிவிப்புகள்', Requests: 'கோரிக்கைகள்', Recognition: 'பாராட்டு', Jobs: 'வேலைகள்', Library: 'நூலகம்', 'My pay': 'என் ஊதியம்', 'My team': 'என் குழு', Approvals: 'ஒப்புதல்கள்', Company: 'நிறுவனம்', People: 'மக்கள்', Hiring: 'ஆட்சேர்ப்பு', Organisation: 'அமைப்பு', Payroll: 'ஊதியம்', Settings: 'அமைப்புகள்',
    'Search anything in HRMS...': 'HRMS இல் தேடுங்கள்...', 'Nothing matches that search.': 'பொருத்தம் இல்லை.', Notifications: 'அறிவிப்புகள்', 'Mark all read': 'அனைத்தும் படித்தது', 'View all': 'அனைத்தும் காண', 'No notifications': 'அறிவிப்பு இல்லை', Expand: 'விரி', Collapse: 'சுருக்கு', Language: 'மொழி', All: 'அனைத்தும்', Waiting: 'காத்திருப்பு', News: 'செய்தி', Badges: 'பேட்ஜ்', 'No pending actions exist for you.': 'உங்களுக்கு நிலுவையில் எதுவும் இல்லை.',
    'Back to people': 'மக்களிடம் திரும்பு', Joined: 'சேர்ந்த நாள்', 'Total service': 'மொத்த சேவை', Manager: 'மேலாளர்', Status: 'நிலை', Personal: 'தனிப்பட்ட', Contact: 'தொடர்பு', 'Date of birth': 'பிறந்த தேதி', Gender: 'பாலினம்', 'Marital status': 'திருமண நிலை', Nationality: 'தேசியம்', 'Blood group': 'இரத்த வகை', Confirmed: 'உறுதி', 'Emergency contact': 'அவசர தொடர்பு', 'Emergency phone': 'அவசர தொலைபேசி', Address: 'முகவரி', 'Not added': 'சேர்க்கப்படவில்லை', 'Your details': 'உங்கள் விவரம்', Save: 'சேமி', Email: 'மின்னஞ்சல்', Phone: 'தொலைபேசி', Location: 'இடம்', Worker: 'பணியாளர் வகை',
  },
  gu: {
    'My day': 'મારો દિવસ', Home: 'ઘર', Attendance: 'હાજરી', Exceptions: 'અપવાદો', Leave: 'રજા', Announcements: 'જાહેરાતો', Requests: 'વિનંતીઓ', Recognition: 'સન્માન', Jobs: 'નોકરીઓ', Library: 'પુસ્તકાલય', 'My pay': 'મારો પગાર', 'My team': 'મારી ટીમ', Approvals: 'મંજૂરીઓ', Company: 'કંપની', People: 'લોકો', Hiring: 'ભરતી', Organisation: 'સંસ્થા', Payroll: 'પગાર', Settings: 'સેટિંગ્સ',
    'Search anything in HRMS...': 'HRMS માં શોધો...', 'Nothing matches that search.': 'કંઈ મળ્યું નહીં.', Notifications: 'સૂચના', 'Mark all read': 'બધું વાંચ્યું', 'View all': 'બધું જુઓ', 'No notifications': 'કોઈ સૂચના નથી', Expand: 'ખોલો', Collapse: 'બંધ કરો', Language: 'ભાષા', All: 'બધું', Waiting: 'રાહ', News: 'સમાચાર', Badges: 'બેજ', 'No pending actions exist for you.': 'તમારા માટે કોઈ બાકી કાર્ય નથી.',
    'Back to people': 'લોકો પર પાછા', Joined: 'જોડાયા', 'Total service': 'કુલ સેવા', Manager: 'મેનેજર', Status: 'સ્થિતિ', Personal: 'વ્યક્તિગત', Contact: 'સંપર્ક', 'Date of birth': 'જન્મ તારીખ', Gender: 'લિંગ', 'Marital status': 'વૈવાહિક સ્થિતિ', Nationality: 'રાષ્ટ્રીયતા', 'Blood group': 'રક્ત જૂથ', Confirmed: 'પુષ્ટિ', 'Emergency contact': 'કટોકટી સંપર્ક', 'Emergency phone': 'કટોકટી ફોન', Address: 'સરનામું', 'Not added': 'ઉમેરાયું નથી', 'Your details': 'તમારી વિગત', Save: 'સાચવો', Email: 'ઈમેલ', Phone: 'ફોન', Location: 'સ્થાન', Worker: 'કર્મચારી પ્રકાર',
  },
  bn: {
    'My day': 'আমার দিন', Home: 'হোম', Attendance: 'উপস্থিতি', Exceptions: 'ব্যতিক্রম', Leave: 'ছুটি', Announcements: 'ঘোষণা', Requests: 'অনুরোধ', Recognition: 'সম্মান', Jobs: 'চাকরি', Library: 'লাইব্রেরি', 'My pay': 'আমার বেতন', 'My team': 'আমার দল', Approvals: 'অনুমোদন', Company: 'কোম্পানি', People: 'মানুষ', Hiring: 'নিয়োগ', Organisation: 'সংগঠন', Payroll: 'বেতন', Settings: 'সেটিংস',
    'Search anything in HRMS...': 'HRMS-এ খুঁজুন...', 'Nothing matches that search.': 'কিছু মেলেনি।', Notifications: 'বিজ্ঞপ্তি', 'Mark all read': 'সব পড়া হয়েছে', 'View all': 'সব দেখুন', 'No notifications': 'কোনো বিজ্ঞপ্তি নেই', Expand: 'খুলুন', Collapse: 'বন্ধ করুন', Language: 'ভাষা', All: 'সব', Waiting: 'অপেক্ষা', News: 'খবর', Badges: 'ব্যাজ', 'No pending actions exist for you.': 'আপনার জন্য কোনো অপেক্ষমাণ কাজ নেই।',
    'Back to people': 'মানুষের কাছে ফিরুন', Joined: 'যোগদান', 'Total service': 'মোট চাকরি', Manager: 'ম্যানেজার', Status: 'অবস্থা', Personal: 'ব্যক্তিগত', Contact: 'যোগাযোগ', 'Date of birth': 'জন্মতারিখ', Gender: 'লিঙ্গ', 'Marital status': 'বৈবাহিক অবস্থা', Nationality: 'জাতীয়তা', 'Blood group': 'রক্তের গ্রুপ', Confirmed: 'নিশ্চিত', 'Emergency contact': 'জরুরি যোগাযোগ', 'Emergency phone': 'জরুরি ফোন', Address: 'ঠিকানা', 'Not added': 'যোগ হয়নি', 'Your details': 'আপনার বিবরণ', Save: 'সংরক্ষণ', Email: 'ইমেল', Phone: 'ফোন', Location: 'অবস্থান', Worker: 'কর্মী ধরন',
  },
  ar: {
    'My day': 'يومي', Home: 'الرئيسية', Attendance: 'الحضور', Exceptions: 'الاستثناءات', Leave: 'الإجازة', Announcements: 'الإعلانات', Requests: 'الطلبات', Recognition: 'التقدير', Jobs: 'الوظائف', Library: 'المكتبة', 'My pay': 'راتبي', 'My team': 'فريقي', Approvals: 'الموافقات', Company: 'الشركة', People: 'الأشخاص', Hiring: 'التوظيف', Organisation: 'المؤسسة', Payroll: 'الرواتب', Settings: 'الإعدادات',
    'Search anything in HRMS...': 'ابحث في النظام...', 'Nothing matches that search.': 'لا توجد نتيجة.', Notifications: 'الإشعارات', 'Mark all read': 'تعليم الكل كمقروء', 'View all': 'عرض الكل', 'No notifications': 'لا إشعارات', Expand: 'توسيع', Collapse: 'طي', Language: 'اللغة', All: 'الكل', Waiting: 'بانتظار', News: 'الأخبار', Badges: 'الأوسمة', 'No pending actions exist for you.': 'لا توجد إجراءات معلّقة لك.',
    'Back to people': 'العودة إلى الأشخاص', Joined: 'تاريخ الالتحاق', 'Total service': 'مدة الخدمة', Manager: 'المدير', Status: 'الحالة', Personal: 'شخصي', Contact: 'التواصل', 'Date of birth': 'تاريخ الميلاد', Gender: 'الجنس', 'Marital status': 'الحالة الاجتماعية', Nationality: 'الجنسية', 'Blood group': 'فصيلة الدم', Confirmed: 'تاريخ التثبيت', 'Emergency contact': 'جهة الطوارئ', 'Emergency phone': 'هاتف الطوارئ', Address: 'العنوان', 'Not added': 'غير مضاف', 'Your details': 'بياناتك', Save: 'حفظ', Email: 'البريد', Phone: 'الهاتف', Location: 'الموقع', Worker: 'نوع العمل',
  },
  es: {
    'My day': 'Mi día', Home: 'Inicio', Attendance: 'Asistencia', Exceptions: 'Excepciones', Leave: 'Ausencia', Announcements: 'Avisos', Requests: 'Solicitudes', Recognition: 'Reconocimiento', Jobs: 'Empleos', Library: 'Biblioteca', 'My pay': 'Mi pago', 'My team': 'Mi equipo', Approvals: 'Aprobaciones', Company: 'Empresa', People: 'Personas', Hiring: 'Contratación', Organisation: 'Organización', Payroll: 'Nómina', Settings: 'Ajustes',
    'Search anything in HRMS...': 'Buscar en el portal...', 'Nothing matches that search.': 'Nada coincide.', Notifications: 'Avisos', 'Mark all read': 'Marcar leído', 'View all': 'Ver todo', 'No notifications': 'Sin avisos', Expand: 'Abrir', Collapse: 'Cerrar', Language: 'Idioma', All: 'Todo', Waiting: 'En espera', News: 'Avisos', Badges: 'Insignias', 'No pending actions exist for you.': 'No tiene acciones pendientes.',
    'Back to people': 'Volver a personas', Joined: 'Ingreso', 'Total service': 'Antigüedad', Manager: 'Jefe', Status: 'Estado', Personal: 'Personal', Contact: 'Contacto', 'Date of birth': 'Fecha de nacimiento', Gender: 'Género', 'Marital status': 'Estado civil', Nationality: 'Nacionalidad', 'Blood group': 'Grupo sanguíneo', Confirmed: 'Confirmación', 'Emergency contact': 'Contacto de emergencia', 'Emergency phone': 'Teléfono de emergencia', Address: 'Dirección', 'Not added': 'Sin dato', 'Your details': 'Tus datos', Save: 'Guardar', Email: 'Correo', Phone: 'Teléfono', Location: 'Sede', Worker: 'Tipo',
  },
  fr: {
    'My day': 'Ma journée', Home: 'Accueil', Attendance: 'Présence', Exceptions: 'Exceptions', Leave: 'Congé', Announcements: 'Annonces', Requests: 'Demandes', Recognition: 'Reconnaissance', Jobs: 'Postes', Library: 'Bibliothèque', 'My pay': 'Ma paie', 'My team': 'Mon équipe', Approvals: 'Approbations', Company: 'Société', People: 'Personnes', Hiring: 'Recrutement', Organisation: 'Organisation', Payroll: 'Paie', Settings: 'Réglages',
    'Search anything in HRMS...': 'Rechercher dans le portail...', 'Nothing matches that search.': 'Aucun résultat.', Notifications: 'Notifications', 'Mark all read': 'Tout marquer lu', 'View all': 'Tout voir', 'No notifications': 'Aucune notification', Expand: 'Ouvrir', Collapse: 'Réduire', Language: 'Langue', All: 'Tout', Waiting: 'En attente', News: 'Annonces', Badges: 'Badges', 'No pending actions exist for you.': 'Aucune action en attente pour vous.',
    'Back to people': 'Retour aux personnes', Joined: 'Entrée', 'Total service': 'Ancienneté', Manager: 'Responsable', Status: 'Statut', Personal: 'Personnel', Contact: 'Contact', 'Date of birth': 'Date de naissance', Gender: 'Genre', 'Marital status': 'Situation', Nationality: 'Nationalité', 'Blood group': 'Groupe sanguin', Confirmed: 'Confirmation', 'Emergency contact': 'Contact d’urgence', 'Emergency phone': 'Téléphone d’urgence', Address: 'Adresse', 'Not added': 'Non renseigné', 'Your details': 'Vos informations', Save: 'Enregistrer', Email: 'E-mail', Phone: 'Téléphone', Location: 'Site', Worker: 'Type',
  },
  he: {
    'My day': 'היום שלי', Home: 'בית', Attendance: 'נוכחות', Exceptions: 'חריגות', Leave: 'חופשה', Announcements: 'הודעות', Requests: 'בקשות', Recognition: 'הוקרה', Jobs: 'משרות', Library: 'ספרייה', 'My pay': 'השכר שלי', 'My team': 'הצוות שלי', Approvals: 'אישורים', Company: 'חברה', People: 'אנשים', Hiring: 'גיוס', Organisation: 'ארגון', Payroll: 'שכר', Settings: 'הגדרות',
    'Search anything in HRMS...': 'חיפוש בפורטל...', 'Nothing matches that search.': 'אין תוצאה.', Notifications: 'התראות', 'Mark all read': 'סמן הכל כנקרא', 'View all': 'הצג הכל', 'No notifications': 'אין התראות', Expand: 'הרחב', Collapse: 'כווץ', Language: 'שפה', All: 'הכל', Waiting: 'ממתין', News: 'חדשות', Badges: 'תגים', 'No pending actions exist for you.': 'אין פעולות ממתינות עבורך.',
    'Back to people': 'חזרה לאנשים', Joined: 'תאריך הצטרפות', 'Total service': 'ותק', Manager: 'מנהל', Status: 'סטטוס', Personal: 'אישי', Contact: 'קשר', 'Date of birth': 'תאריך לידה', Gender: 'מגדר', 'Marital status': 'מצב משפחתי', Nationality: 'לאום', 'Blood group': 'סוג דם', Confirmed: 'קביעות', 'Emergency contact': 'איש קשר לחירום', 'Emergency phone': 'טלפון חירום', Address: 'כתובת', 'Not added': 'לא הוזן', 'Your details': 'הפרטים שלך', Save: 'שמירה', Email: 'דוא״ל', Phone: 'טלפון', Location: 'מיקום', Worker: 'סוג עובד',
  },
};

@Injectable({ providedIn: 'root' })
export class I18n {
  readonly languages = LANGUAGES;
  readonly code = signal(this.stored());

  constructor() {
    document.documentElement.lang = this.code();
  }

  t(text: string): string {
    const pack = packs[this.code()];
    return pack?.[text] || text;
  }

  choose(id: string): void {
    const next = LANGUAGES.some((item) => item.id === id) ? id : 'en';
    localStorage.setItem(KEY, next);
    this.code.set(next);
    document.documentElement.lang = next;
  }

  current(): LanguageChoice {
    return LANGUAGES.find((item) => item.id === this.code()) || LANGUAGES[0];
  }

  private stored(): string {
    const saved = localStorage.getItem(KEY) || 'en';
    return LANGUAGES.some((item) => item.id === saved) ? saved : 'en';
  }
}
