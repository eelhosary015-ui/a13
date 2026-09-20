/**
 * سكريبت إضافة جزاءات افتراضية لائحة الجزاءات
 * يعمل مع نظام ERP عبر قاعدة البيانات المباشرة
 */

const fs = require('fs');
const path = require('path');

// قراءة قاعدة البيانات المباشرة
const dbPath = path.join(__dirname, '../backups/offline-db.json');

// الجزاءات الافتراضية
const defaultPenalties = [
  // === جزاءات التأخير (delay) ===
  {
    name: 'تأخير 10 دقائق',
    amount: 10,
    type: 'minutes',
    category: 'delay',
    threshold_minutes: 10,
    notes: 'يتم تطبيق هذا الجزاء عند تأخر الموظف من 1 إلى 15 دقيقة'
  },
  {
    name: 'تأخير 30 دقيقة (نص ساعة)',
    amount: 30,
    type: 'minutes',
    category: 'delay',
    threshold_minutes: 30,
    notes: 'يتم تطبيق هذا الجزاء عند تأخر الموظف من 16 إلى 45 دقيقة'
  },
  {
    name: 'تأخير ساعة كاملة',
    amount: 60,
    type: 'minutes',
    category: 'delay',
    threshold_minutes: 60,
    notes: 'يتم تطبيق هذا الجزاء عند تأخر الموظف من 46 دقيقة إلى ساعتين'
  },
  {
    name: 'تأخير أكثر من ساعتين',
    amount: 120,
    type: 'minutes',
    category: 'delay',
    threshold_minutes: 120,
    notes: 'يتم تطبيق هذا الجزاء عند تأخر الموظف أكثر من ساعتين'
  },
  {
    name: 'خصم مالي ثابت - تأخير خفيف',
    amount: 10,
    type: 'amount',
    category: 'delay',
    threshold_minutes: 15,
    notes: 'خصم 10 جنيه للتأخير البسيط (حتى 15 دقيقة)'
  },
  {
    name: 'خصم مالي ثابت - تأخير متوسط',
    amount: 25,
    type: 'amount',
    category: 'delay',
    threshold_minutes: 30,
    notes: 'خصم 25 جنيه للتأخير المتوسط (16-30 دقيقة)'
  },
  {
    name: 'خصم مالي ثابت - تأخير شديد',
    amount: 50,
    type: 'amount',
    category: 'delay',
    threshold_minutes: 60,
    notes: 'خصم 50 جنيه للتأخير الشديد (أكثر من ساعة)'
  },

  // === جزاءات الانصراف المبكر (early_leave) ===
  {
    name: 'انصراف مبكر - أقل من ساعة',
    amount: 30,
    type: 'minutes',
    category: 'early_leave',
    threshold_minutes: 30,
    notes: 'خصم 30 دقيقة للانصراف المبكر أقل من ساعة'
  },
  {
    name: 'انصراف مبكر - ساعة أو أكثر',
    amount: 60,
    type: 'minutes',
    category: 'early_leave',
    threshold_minutes: 60,
    notes: 'خصم ساعة كاملة للانصراف المبكر ساعة أو أكثر'
  },

  // === جزاءات الغياب (absence) ===
  {
    name: 'غياب بدون عذر',
    amount: 1,
    type: 'days',
    category: 'absence',
    threshold_minutes: 0,
    notes: 'خصم يوم كامل للغياب بدون عذر'
  },

  // === جزاءات نسيان البصمة (missing_punch) ===
  {
    name: 'نسيان بصمة الدخول أو الخروج',
    amount: 30,
    type: 'minutes',
    category: 'missing_punch',
    threshold_minutes: 0,
    notes: 'خصم 30 دقيقة عند نسيان تسجيل بصمة الدخول أو الخروج'
  }
];

function loadDb() {
  try {
    if (fs.existsSync(dbPath)) {
      const raw = fs.readFileSync(dbPath, "utf8").trim();
      return raw ? JSON.parse(raw) : {};
    }
  } catch (e) {
    console.error('خطأ في قراءة قاعدة البيانات:', e.message);
  }
  return {};
}

function saveDb(dbState) {
  try {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(dbPath, JSON.stringify(dbState, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('خطأ في حفظ قاعدة البيانات:', e.message);
    return false;
  }
}

function seedPenalties() {
  console.log('🔄 جاري إضافة جزاءات لائحة الجزاءات الافتراضية...\n');
  
  const dbState = loadDb();
  
  // التأكد من وجود مصفوفة hr_penalties
  if (!dbState.hr_penalties) {
    dbState.hr_penalties = [];
  }
  
  let addedCount = 0;
  let skippedCount = 0;
  
  for (const penalty of defaultPenalties) {
    // التحقق من وجود الجزاء مسبقاً (بالاسم والتصنيف)
    const existing = dbState.hr_penalties.find(
      p => p.name === penalty.name && p.category === penalty.category
    );
    
    if (existing) {
      console.log(`⏭️  تم تخطي: ${penalty.name} (موجود مسبقاً)`);
      skippedCount++;
      continue;
    }
    
    // إنشاء ID جديد
    const maxId = dbState.hr_penalties.reduce((max, p) => Math.max(max, p.id || 0), 0);
    
    // إضافة الجزاء الجديد
    const newPenalty = {
      id: maxId + 1,
      name: penalty.name,
      amount: penalty.amount,
      type: penalty.type,
      notes: penalty.notes,
      category: penalty.category,
      threshold_minutes: penalty.threshold_minutes,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    dbState.hr_penalties.push(newPenalty);
    console.log(`✅ تم إضافة: ${penalty.name} (${penalty.category})`);
    addedCount++;
  }
  
  // حفظ التغييرات
  if (addedCount > 0) {
    if (saveDb(dbState)) {
      console.log('\n' + '='.repeat(50));
      console.log(`📊 ملخص العملية:`);
      console.log(`   ✅ تم إضافة ${addedCount} جزاء جديد`);
      console.log(`   ⏭️  تم تخطي ${skippedCount} جزاء (موجود مسبقاً)`);
      console.log('='.repeat(50));
      
      // عرض جميع الجزاءات الحالية
      console.log('\n📋 لائحة الجزاءات الحالية:\n');
      
      const categories = {
        'delay': '🔴 التأخير',
        'early_leave': '🟠 الانصراف المبكر',
        'absence': '⚫ الغياب',
        'missing_punch': '🟡 نسيان البصمة',
        'manual': '⚪ يدوي / عام'
      };
      
      for (const [catKey, catLabel] of Object.entries(categories)) {
        const catPenalties = dbState.hr_penalties.filter(p => p.category === catKey);
        if (catPenalties.length > 0) {
          console.log(`${catLabel}:`);
          catPenalties.forEach(p => {
            const typeLabel = p.type === 'amount' ? 'ج.م' : p.type === 'days' ? 'يوم' : 'دقيقة';
            console.log(`   • ${p.name} → ${p.amount} ${typeLabel} (threshold: ${p.threshold_minutes} دقيقة)`);
          });
          console.log('');
        }
      }
      
      return true;
    } else {
      console.error('❌ فشل في حفظ التغييرات');
      return false;
    }
  } else {
    console.log('\nℹ️  لا توجد جزاءات جديدة لإضافتها');
    return true;
  }
}

// تشغيل السكريبت
const success = seedPenalties();
process.exit(success ? 0 : 1);
