const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

admin.initializeApp();

// ========== MESAİ PLANLARI ==========
const WORK_TEAMS = [
  {
    name: "1. Ekip - Standart",
    pins: ["61704", "45823", "73621", "58392", "29847", "41927"], // Veli, Gökmen, Şaban, Dilara, Bahriye, Şeyma
    schedule: {
      weekdays: { start: "08:00", end: "17:00", workDays: [1, 2, 3, 4, 5, 6] },
      saturday: { start: "08:00", end: "12:30" }
    }
  },
  {
    name: "2. Ekip - Üretim",
    pins: ["64829", "28573", "91346", "53018", "82947", "72541", "87654", "87655"], // Kaynakçılar, Lazerciler, Boyacılar
    schedule: {
      weekdays: { start: "07:45", end: "17:45", workDays: [1, 2, 3, 4, 5] }
    }
  },
  {
    name: "3. Ekip - Vardiyalı",
    pins: ["68503"], // Evan
    schedule: {
      morningShift: { start: "10:30", end: "17:00", workDays: [1, 2, 3, 4, 5] },
      eveningShift: { start: "20:30", end: "23:49", workDays: [1, 2, 3, 4, 5] }
    }
  }
];

// PIN-isim eşleştirmesi
const PIN_NAMES = {
  "67431": "Burak", "99999": "Mesut", "45823": "Gökmen", "73621": "Şaban",
  "29847": "Bahriye", "58392": "Dilara", "61704": "Veli", "34562": "Bahriye",
  "64829": "Emin", "28573": "İlhami", "91346": "Atasoy", "53018": "Veysel",
  "82947": "Abdullah", "72541": "Emre K.", "41927": "Şeyma A.", "68503": "Evan",
  "87654": "Nasır", "87655": "Talha"
};

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function isWorkDay(team, dayOfWeek) {
  const schedule = team.schedule;
  if (dayOfWeek === 6 && schedule.saturday) return true;
  if (schedule.weekdays && schedule.weekdays.workDays.includes(dayOfWeek)) return true;
  if (schedule.morningShift && schedule.morningShift.workDays.includes(dayOfWeek)) return true;
  return false;
}

function getCurrentShift(team, currentMinutes, dayOfWeek) {
  const schedule = team.schedule;
  
  // Cumartesi kontrolü
  if (dayOfWeek === 6 && schedule.saturday) {
    return { type: 'saturday', start: schedule.saturday.start, end: schedule.saturday.end };
  }
  
  // Standart mesai
  if (schedule.weekdays) {
    return { type: 'weekday', start: schedule.weekdays.start, end: schedule.weekdays.end };
  }
  
  // Vardiyalı mesai (Ekip 3)
  if (schedule.morningShift && schedule.eveningShift) {
    const morningStart = timeToMinutes(schedule.morningShift.start);
    const eveningStart = timeToMinutes(schedule.eveningShift.start);
    
    // Sabah vardiyası kontrolü (10:30 için 10:35-10:37)
    if (currentMinutes >= morningStart + 5 && currentMinutes <= morningStart + 7) {
      return { type: 'morning', start: schedule.morningShift.start, end: schedule.morningShift.end };
    }
    
    // Akşam vardiyası kontrolü (20:30 için 20:35-20:37)
    if (currentMinutes >= eveningStart + 5 && currentMinutes <= eveningStart + 7) {
      return { type: 'evening', start: schedule.eveningShift.start, end: schedule.eveningShift.end };
    }
  }
  
  return null;
}

// Telegram mesaj gönder
async function sendTelegramMessage(botToken, chatId, message) {
  if (!botToken) {
    console.error('Bot token eksik');
    return false;
  }
  
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      })
    });
    
    const result = await response.json();
    if (result.ok) {
      console.log(`Telegram mesajı gönderildi: ${chatId}`);
      return true;
    } else {
      console.error('Telegram API hatası:', result);
      return false;
    }
  } catch (error) {
    console.error('Telegram gönderim hatası:', error);
    return false;
  }
}

// FCM bildirim gönderme fonksiyonu
exports.sendFCMNotification = functions.firestore
  .document('fcmRequests/{requestId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    
    try {
      console.log('FCM isteği alındı:', data);
      
      const { tokens, notification } = data;
      
      if (!tokens || tokens.length === 0) {
        console.log('Token bulunamadı');
        return null;
      }
      
      // Her token için gönder
      const promises = tokens.map(token => {
        return admin.messaging().send({
          token: token,
          notification: {
            title: notification.title,
            body: notification.body,
          },
          android: {
            priority: 'high',
          },
          webpush: {
            notification: {
              requireInteraction: true,
            }
          }
        }).catch(err => {
          console.error('Token hatası:', token, err.message);
          return null;
        });
      });
      
      const results = await Promise.all(promises);
      const successCount = results.filter(r => r !== null).length;
      
      console.log(`Gönderilen: ${successCount}/${tokens.length}`);
      
      // Güncelle
      await snap.ref.update({
        status: 'sent',
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        successCount: successCount
      });
      
      return null;
    } catch (error) {
      console.error('Hata:', error);
      await snap.ref.update({
        status: 'failed',
        error: error.message
      });
      return null;
    }
  });

// Bildirim kurallarına göre Telegram + FCM isteği oluştur
exports.createNotificationRequest = functions.firestore
  .document('notifications/{notificationId}')
  .onCreate(async (snap, context) => {
    const notificationData = snap.data();
    
    try {
      console.log('Yeni bildirim:', notificationData);
      
      const { eventType, targetRoles, targetPins, targetDesignerPin, targetPin, title, body } = notificationData;
      const db = admin.firestore();
      
      // 1. TELEGRAM BİLDİRİMLERİ (Öncelikli)
      try {
        // Bot token'ı al
        const configDoc = await db.collection('config').doc('telegram').get();
        if (configDoc.exists && configDoc.data().botToken) {
          const botToken = configDoc.data().botToken;
          console.log('Bot token bulundu, bildirim gönderiliyor...');
          console.log('targetPins:', targetPins);
          console.log('targetPin:', targetPin);
          console.log('targetRoles:', targetRoles);
          console.log('targetDesignerPin:', targetDesignerPin);
          
          // Hedef kullanıcıları belirle
          const telegramPromises = [];
          
          // Tekil PIN'e gönder (kargo bildirimleri için)
          if (targetPin) {
            const usersSnapshot = await db.collection('telegramUsers').get();
            usersSnapshot.forEach(doc => {
              const userData = doc.data();
              if (userData.pin === targetPin && userData.chatId) {
                const message = `<b>${title}</b>\n\n${body}`;
                console.log(`Tekil PIN'e mesaj gönderiliyor: ${userData.name} (${userData.pin}) -> ${userData.chatId}`);
                telegramPromises.push(sendTelegramMessage(botToken, userData.chatId, message));
              }
            });
          }
          
          // Önce belirli PIN'lere gönder (targetPins)
          if (targetPins && targetPins.length > 0) {
            // PIN'lere göre gönder - Array olduğu için döngü ile işle
            const usersSnapshot = await db.collection('telegramUsers').get();
            usersSnapshot.forEach(doc => {
              const userData = doc.data();
              if (targetPins.includes(userData.pin) && userData.chatId) {
                const message = `<b>${title}</b>\n\n${body}`;
                console.log(`Mesaj gönderiliyor: ${userData.name} (${userData.pin}) -> ${userData.chatId}`);
                telegramPromises.push(sendTelegramMessage(botToken, userData.chatId, message));
              }
            });
          }
          
          // Atanmış tasarımcıya özel gönder (targetDesignerPin)
          if (targetDesignerPin) {
            const usersSnapshot = await db.collection('telegramUsers').get();
            usersSnapshot.forEach(doc => {
              const userData = doc.data();
              if (userData.pin === targetDesignerPin && userData.chatId) {
                const message = `<b>${title}</b>\n\n${body}`;
                console.log(`Atanmış tasarımcıya mesaj gönderiliyor: ${userData.name} (${userData.pin}) -> ${userData.chatId}`);
                telegramPromises.push(sendTelegramMessage(botToken, userData.chatId, message));
              }
            });
          }
          
          // Role'lere göre gönder (targetRoles)
          if (targetRoles && targetRoles.length > 0) {
            const usersSnapshot = await db.collection('telegramUsers').get();
            usersSnapshot.forEach(doc => {
              const userData = doc.data();
              if (targetRoles.includes(userData.role) && userData.chatId) {
                // Sayfa yöneticileri için özel filtreleme
                if (userData.role === 'page_manager') {
                  const notificationType = notificationData.type || '';
                  
                  // Mola/yemek/mesai bildirimlerini sayfa yöneticilerine gönderme
                  const isMolaNotification = title && (
                    title.includes('Mola') || 
                    title.includes('Yemek') || 
                    title.includes('Mesai') ||
                    title.includes('☕') ||
                    title.includes('🍽️') ||
                    title.includes('🏠')
                  );
                  if (isMolaNotification) {
                    console.log(`Sayfa yöneticisine mola/mesai bildirimi atlanıyor: ${userData.name}`);
                    return;
                  }
                  
                  // Kişiye özel sipariş bildirimi kontrolü
                  const isCustomOrder = notificationType.startsWith('custom_order') || notificationType === 'design_task_claimed';
                  if (isCustomOrder) {
                    // targetPageManagerPin varsa sadece o kişiye gönder
                    if (notificationData.targetPageManagerPin) {
                      if (userData.pin !== notificationData.targetPageManagerPin) {
                        console.log(`Sayfa yöneticisi ${userData.name} (${userData.pin}) - bu sipariş ${notificationData.targetPageManagerPin}'a ait, atlanıyor`);
                        return;
                      }
                    } else {
                      // targetPageManagerPin yoksa hiçbir sayfa yöneticisine gönderme
                      console.log(`Sayfa yöneticisi ${userData.name} - targetPageManagerPin yok, atlanıyor`);
                      return;
                    }
                  }
                }
                
                const message = `<b>${title}</b>\n\n${body}`;
                console.log(`Mesaj gönderiliyor: ${userData.name} (${userData.role}) -> ${userData.chatId}`);
                telegramPromises.push(sendTelegramMessage(botToken, userData.chatId, message));
              }
            });
          }
          
          // Veli (61704) - Kişiye özel sipariş bildirimlerinde her zaman bildirim alsın
          const isCustomOrderNotification = notificationData.type && (
            notificationData.type.startsWith('custom_order') || 
            notificationData.type === 'design_task_claimed'
          );
          if (isCustomOrderNotification) {
            const veliSnapshot = await db.collection('telegramUsers').where('pin', '==', '61704').get();
            veliSnapshot.forEach(doc => {
              const userData = doc.data();
              if (userData.chatId) {
                const message = `<b>${title}</b>\n\n${body}`;
                console.log(`Veli'ye kişiye özel sipariş bildirimi gönderiliyor: ${userData.chatId}`);
                telegramPromises.push(sendTelegramMessage(botToken, userData.chatId, message));
              }
            });
          }
          
          // Emre K. (72541) - Hem tasarımcı hem lazerci, lazerci bildirimlerini de alsın
          const isLaserNotification = targetRoles && targetRoles.includes('laser');
          if (isLaserNotification) {
            const emreSnapshot = await db.collection('telegramUsers').where('pin', '==', '72541').get();
            emreSnapshot.forEach(doc => {
              const userData = doc.data();
              // Eğer rolü laser değilse (yani designer olarak kayıtlıysa) bildirim gönder
              if (userData.chatId && userData.role !== 'laser') {
                const message = `<b>${title}</b>\n\n${body}`;
                console.log(`Emre K.'ya lazerci bildirimi gönderiliyor (ikinci rol): ${userData.chatId}`);
                telegramPromises.push(sendTelegramMessage(botToken, userData.chatId, message));
              }
            });
          }
          
          if (telegramPromises.length > 0) {
            console.log(`${telegramPromises.length} Telegram mesajı gönderiliyor...`);
            const telegramResults = await Promise.allSettled(telegramPromises);
            const telegramSuccess = telegramResults.filter(r => r.status === 'fulfilled' && r.value === true).length;
            console.log(`Telegram: ${telegramSuccess}/${telegramPromises.length} başarıyla gönderildi`);
          } else {
            console.log('Telegram bildirim alacak kullanıcı bulunamadı');
          }
        } else {
          console.log('Bot token bulunamadı');
        }
      } catch (telegramError) {
        console.error('Telegram bildirim hatası:', telegramError);
      }
      
      // 2. FCM BİLDİRİMLERİ (Yedek - desktop/Android için)
      let tokensQuery;
      if (targetPins && targetPins.length > 0) {
        tokensQuery = db.collection('fcmTokens').where('pin', 'in', targetPins);
      } else if (targetDesignerPin) {
        tokensQuery = db.collection('fcmTokens').where('pin', '==', targetDesignerPin);
      } else if (targetRoles && targetRoles.length > 0) {
        tokensQuery = db.collection('fcmTokens').where('role', 'in', targetRoles);
      }
      
      if (tokensQuery) {
        const tokensSnapshot = await tokensQuery.get();
        const tokens = [];
        
        tokensSnapshot.forEach(doc => {
          tokens.push(doc.data().token);
        });
        
        if (tokens.length > 0) {
          await db.collection('fcmRequests').add({
            tokens: tokens,
            notification: { title, body },
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            status: 'pending'
          });
          console.log(`FCM: ${tokens.length} kullanıcıya istek oluşturuldu`);
        }
      }
      
      return null;
      
    } catch (error) {
      console.error('Bildirim isteği oluşturma hatası:', error);
      return null;
    }
  });

// ========== ZAMANLANMIŞ MESAİ KONTROL FONKSİYONU ==========
// Her dakika çalışır ve mesai saatlerini kontrol eder
exports.checkShiftAttendance = functions.pubsub
  .schedule('* * * * *') // Her dakika
  .timeZone('Europe/Istanbul')
  .onRun(async (context) => {
    const db = admin.firestore();
    
    try {
      const now = new Date();
      // Türkiye saati için +3 saat ekle
      const turkeyTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
      const currentHour = turkeyTime.getUTCHours();
      const currentMinute = turkeyTime.getUTCMinutes();
      const currentMinutes = currentHour * 60 + currentMinute;
      const dayOfWeek = turkeyTime.getUTCDay();
      const currentDate = turkeyTime.toISOString().split('T')[0];
      const currentTime = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;
      
      console.log(`🔍 Mesai kontrolü: ${currentTime} (${currentDate}) - Gün: ${dayOfWeek}`);
      
      // Bot token'ı al
      const configDoc = await db.collection('config').doc('telegram').get();
      if (!configDoc.exists || !configDoc.data().botToken) {
        console.log('Bot token bulunamadı, kontrol atlanıyor');
        return null;
      }
      const botToken = configDoc.data().botToken;
      
      // Telegram kullanıcılarını al
      const telegramUsersSnapshot = await db.collection('telegramUsers').get();
      const telegramUsers = {};
      const allTelegramUsers = []; // Mola bildirimleri için tüm kullanıcılar
      telegramUsersSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.chatId) {
          telegramUsers[data.pin] = data;
          allTelegramUsers.push(data);
        }
      });
      
      // ========== MOLA BİLDİRİMLERİ ==========
      // Pazar günü mola bildirimi gönderme
      if (dayOfWeek !== 0) {
        // Ekip 1 PIN'leri
        const TEAM1_PINS = ["61704", "45823", "73621", "58392", "29847", "41927"];
        // Ekip 2 PIN'leri
        const TEAM2_PINS = ["64829", "28573", "91346", "53018", "82947", "72541", "87654", "87655"];
        // Ekip 3 PIN'leri (Evan)
        const TEAM3_PINS = ["68503"];
        // Ekip 2 ve 3 PIN'leri (diğerleri)
        const OTHER_TEAMS_PINS = [...TEAM2_PINS, ...TEAM3_PINS];
        
        // Cumartesi mi kontrol et
        const isSaturday = dayOfWeek === 6;
        
        const BREAK_SCHEDULE = [
          // Çay molası - Herkes (10:00 - 10:15)
          { hour: 10, minute: 0, message: "☕ Çay Molası!", body: "Biraz dinlenelim, çay molası!", teams: "all" },
          { hour: 10, minute: 15, message: "⏰ Çay Molası Bitti!", body: "Kolay gelsin, çalışmaya devam!", teams: "all" },
          
          // Öğle yemeği başlangıç - Herkes (12:30)
          { hour: 12, minute: 30, message: "🍽️ Öğle Yemeği!", body: "Afiyet olsun!", teams: "all", skipSaturday: true },
          
          // Öğle yemeği bitiş - Ekip 1 (13:15)
          { hour: 13, minute: 15, message: "⏰ Öğle Molası Bitti!", body: "Kolay gelsin, çalışmaya devam!", teams: "team1", skipSaturday: true },
          
          // Öğle yemeği bitiş - Diğer ekipler (13:30)
          { hour: 13, minute: 30, message: "⏰ Öğle Molası Bitti!", body: "Kolay gelsin, çalışmaya devam!", teams: "others", skipSaturday: true },
          
          // İkindi molası başlangıç - Herkes (15:00)
          { hour: 15, minute: 0, message: "☕ İkindi Molası!", body: "Biraz dinlenelim!", teams: "all", skipSaturday: true },
          
          // İkindi molası bitiş - Herkes (15:15)
          { hour: 15, minute: 15, message: "⏰ İkindi Molası Bitti!", body: "Kolay gelsin, çalışmaya devam!", teams: "all", skipSaturday: true },
          
          // ========== MESAİ BİTİŞ BİLDİRİMLERİ ==========
          // Ekip 1 ve Ekip 3 (sabah vardiyası) - 17:00
          { hour: 17, minute: 0, message: "🏠 Mesai Bitti!", body: "Emekleriniz için teşekkür ederiz. İyi günler :)", teams: "team1_team3", skipSaturday: true },
          
          // Ekip 2 - 17:45
          { hour: 17, minute: 45, message: "🏠 Mesai Bitti!", body: "Emekleriniz için teşekkür ederiz. İyi günler :)", teams: "team2", skipSaturday: true },
          
          // Ekip 3 akşam vardiyası - 23:49
          { hour: 23, minute: 49, message: "🏠 Mesai Bitti!", body: "Emekleriniz için teşekkür ederiz. İyi geceler :)", teams: "team3", skipSaturday: true },
          
          // Cumartesi Ekip 1 mesai bitişi - 12:30
          { hour: 12, minute: 30, message: "🏠 Mesai Bitti!", body: "Emekleriniz için teşekkür ederiz. İyi hafta sonları :)", teams: "team1_saturday", onlySaturday: true }
        ];
        
        // Bu dakikaya uyan tüm molaları bul
        const matchingBreaks = BREAK_SCHEDULE.filter(b => {
          if (b.hour !== currentHour || b.minute !== currentMinute) return false;
          if (b.skipSaturday && isSaturday) return false;
          if (b.onlySaturday && !isSaturday) return false;
          return true;
        });
        
        for (const matchingBreak of matchingBreaks) {
          const breakKey = `break_${currentDate}_${matchingBreak.hour}_${matchingBreak.minute}_${matchingBreak.teams}`;
          const breakDoc = await db.collection('breakNotifications').doc(breakKey).get();
          
          if (!breakDoc.exists) {
            console.log(`📢 Mola bildirimi gönderiliyor: ${matchingBreak.message} (${matchingBreak.teams})`);
            
            let breakSentCount = 0;
            const breakSentUsers = [];
            
            // Hedef kullanıcıları belirle
            let targetUsers = [];
            if (matchingBreak.teams === "all") {
              targetUsers = allTelegramUsers;
            } else if (matchingBreak.teams === "team1" || matchingBreak.teams === "team1_saturday") {
              targetUsers = allTelegramUsers.filter(u => TEAM1_PINS.includes(u.pin));
            } else if (matchingBreak.teams === "team2") {
              targetUsers = allTelegramUsers.filter(u => TEAM2_PINS.includes(u.pin));
            } else if (matchingBreak.teams === "team3") {
              targetUsers = allTelegramUsers.filter(u => TEAM3_PINS.includes(u.pin));
            } else if (matchingBreak.teams === "team1_team3") {
              targetUsers = allTelegramUsers.filter(u => TEAM1_PINS.includes(u.pin) || TEAM3_PINS.includes(u.pin));
            } else if (matchingBreak.teams === "others") {
              targetUsers = allTelegramUsers.filter(u => OTHER_TEAMS_PINS.includes(u.pin));
            }
            
            for (const userData of targetUsers) {
              const message = `<b>${matchingBreak.message}</b>\n\n${matchingBreak.body}`;
              const sent = await sendTelegramMessage(botToken, userData.chatId, message);
              if (sent) {
                breakSentCount++;
                breakSentUsers.push(userData.name || userData.pin);
              }
            }
            
            // Bu mola bildirimi gönderildi olarak işaretle
            await db.collection('breakNotifications').doc(breakKey).set({
              date: currentDate,
              hour: matchingBreak.hour,
              minute: matchingBreak.minute,
              message: matchingBreak.message,
              teams: matchingBreak.teams,
              sentAt: admin.firestore.FieldValue.serverTimestamp(),
              sentCount: breakSentCount,
              sentUsers: breakSentUsers
            });
            
            console.log(`✅ Mola bildirimi (${matchingBreak.teams}) ${breakSentCount} kişiye gönderildi`);
          }
        }
      }
      // ========== MOLA BİLDİRİMLERİ SONU ==========
      
      for (const team of WORK_TEAMS) {
        // Bu ekip bugün çalışıyor mu?
        if (!isWorkDay(team, dayOfWeek)) {
          continue;
        }
        
        // Standart mesai kontrolü (5-7 dakika arası)
        let shift = null;
        const schedule = team.schedule;
        
        if (schedule.weekdays && !schedule.morningShift) {
          const shiftStart = timeToMinutes(schedule.weekdays.start);
          // Mesai başlangıcından 5-7 dakika sonra kontrol (örn: 07:45 için 07:50-07:52)
          if (currentMinutes >= shiftStart + 5 && currentMinutes <= shiftStart + 7) {
            shift = { type: 'weekday', start: schedule.weekdays.start };
          }
        }
        
        // Cumartesi kontrolü
        if (dayOfWeek === 6 && schedule.saturday) {
          const shiftStart = timeToMinutes(schedule.saturday.start);
          if (currentMinutes >= shiftStart + 5 && currentMinutes <= shiftStart + 7) {
            shift = { type: 'saturday', start: schedule.saturday.start };
          }
        }
        
        // Vardiyalı mesai (Ekip 3)
        if (schedule.morningShift) {
          shift = getCurrentShift(team, currentMinutes, dayOfWeek);
        }
        
        if (!shift) {
          continue;
        }
        
        // Bu ekip için bugün zaten bildirim gönderildi mi?
        const reminderKey = `${team.name}_${currentDate}_${shift.start}`;
        const reminderDoc = await db.collection('shiftReminders').doc(reminderKey).get();
        if (reminderDoc.exists) {
          console.log(`⏭️ ${team.name}: Bugün ${shift.start} mesaisi için zaten bildirim gönderildi`);
          continue;
        }
        
        console.log(`📋 ${team.name} kontrol ediliyor (${shift.start} mesaisi)...`);
        
        let sentCount = 0;
        const sentUsers = [];
        
        // Ekipteki her kullanıcıyı kontrol et
        for (const pin of team.pins) {
          const userName = PIN_NAMES[pin] || pin;
          
          // Kullanıcının bugün girişi var mı?
          const attendanceSnapshot = await db.collection('attendance')
            .where('pin', '==', pin)
            .where('date', '==', currentDate)
            .get();
          
          let hasCheckIn = false;
          if (!attendanceSnapshot.empty) {
            const data = attendanceSnapshot.docs[0].data();
            const timestamps = data.timestamps || [];
            // Herhangi bir giriş kaydı varsa
            hasCheckIn = timestamps.some(t => t.type === 'in');
          }
          
          if (!hasCheckIn) {
            // Giriş yapılmamış - Telegram bildirimi gönder
            const telegramUser = telegramUsers[pin];
            if (telegramUser && telegramUser.chatId) {
              const message = `<b>⏰ ${team.name} - Giriş Hatırlatması</b>\n\n` +
                             `Mesai Başlama Saati: ${shift.start}\n\n` +
                             `Henüz giriş yapılmadı!\n\n` +
                             `Geç kalacaksanız lütfen mazeret bildiriniz.`;
              
              const sent = await sendTelegramMessage(botToken, telegramUser.chatId, message);
              if (sent) {
                sentCount++;
                sentUsers.push(userName);
                console.log(`📢 ${userName} (${pin}): Bildirim gönderildi`);
              }
            } else {
              console.log(`⚠️ ${userName} (${pin}): Chat ID yok, bildirim gönderilemedi`);
            }
            
            // Log kaydet
            await db.collection('logs').add({
              timestamp: new Date().toISOString(),
              action: 'CHECK_IN_REMINDER',
              pin: pin,
              role: 'system',
              shelf: '-',
              product: userName,
              qty: 0,
              detail: `${team.name} - ${shift.start} mesaisi için hatırlatma gönderildi`,
              ts: admin.firestore.FieldValue.serverTimestamp()
            });
          } else {
            console.log(`✅ ${userName} (${pin}): Bugün giriş yapmış`);
          }
        }
        
        // Bu ekip için bugün bildirim gönderildi olarak işaretle
        await db.collection('shiftReminders').doc(reminderKey).set({
          team: team.name,
          date: currentDate,
          shift: shift.start,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          sentCount: sentCount,
          sentUsers: sentUsers
        });
        
        console.log(`✅ ${team.name}: ${sentCount} kişiye bildirim gönderildi`);
      }
      
      return null;
      
    } catch (error) {
      console.error('Mesai kontrolü hatası:', error);
      return null;
    }
  });
