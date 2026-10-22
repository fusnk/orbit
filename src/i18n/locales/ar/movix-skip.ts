import type { movixSkip as source } from '../en/movix-skip';
import type { Catalog } from '../types';

export const movixSkip: Catalog<typeof source> = {
  'movix.aniskip': "أوقات تخطي الأنمي من AniSkip",
  'movix.aniskip-hint': "في الأنمي يسأل أيضًا AniSkip، وهي قاعدة بيانات مجتمعية مجانية، عن مواضع الشارة الافتتاحية والختامية والملخص. لا يرسل إلا معرّف المسلسل على MyAnimeList ورقم الحلقة؛ وقد يُنزّل قائمة معرّفات عامة من GitHub للتعرّف على المسلسل. متوقف ما لم تشغّله.",
  'movix.smooth': "تخطٍّ سلس",
  'movix.smooth-hint': "عند التخطي تتلاشى الصورة إلى الأسود ويخفت الصوت لحظة، ثم يعودان. مع تشغيل «تقليل الحركة» يبقى التخطي فوريًا.",
  'movix.button-delay': "إظهار زر التخطي بعد",
  'movix.button-delay-hint': "يترك بداية المقدمة أو شارة النهاية تُعرض قبل ظهور زر التخطي، كي لا يغطي الزر نهاية المشهد. التخطي التلقائي لا ينتظر.",
  'movix.button-delay-none': "فورًا",
  'movix.landing': "التوقف قبل النهاية",
  'movix.landing-hint': "ينتهي التخطي قبل نهاية المقدمة أو الملخص بهذا القدر، كي لا تُقطع أول لحظة بعدها. شارة النهاية الممتدة حتى الآخر تنتقل إلى النهاية كما كانت.",
  'movix.landing-none': "عند النهاية",
  'movix.color-intro': "لون المقدمة",
  'movix.color-recap': "لون الملخص",
  'movix.color-credits': "لون شارة النهاية",
  'movix.color-preview': "لون اللمحة عن القادم",
  'movix.colors-hint': "شكل كل جزء على شريط التقدم.",
  'movix.swatch.default': "قياسي",
  'movix.swatch.amber': "كهرماني",
  'movix.swatch.sky': "أزرق سماوي",
  'movix.swatch.mint': "نعناعي",
  'movix.swatch.rose': "وردي",
  'movix.swatch.violet': "بنفسجي",
  'movix.swatch.white': "أبيض",
};
