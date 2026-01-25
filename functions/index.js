const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

admin.initializeApp();

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
      
      const { eventType, targetRoles, targetPins, title, body } = notificationData;
      const db = admin.firestore();
      
      // 1. TELEGRAM BİLDİRİMLERİ (Öncelikli)
      try {
        // Bot token'ı al
        const configDoc = await db.collection('config').doc('telegram').get();
        if (configDoc.exists && configDoc.data().botToken) {
          const botToken = configDoc.data().botToken;
          
          // Hedef kullanıcıları belirle
          let telegramQuery;
          if (targetPins && targetPins.length > 0) {
            telegramQuery = db.collection('telegramUsers').where('pin', 'in', targetPins);
          } else if (targetRoles && targetRoles.length > 0) {
            telegramQuery = db.collection('telegramUsers').where('role', 'in', targetRoles);
          }
          
          if (telegramQuery) {
            const telegramSnapshot = await telegramQuery.get();
            const telegramPromises = [];
            
            telegramSnapshot.forEach(doc => {
              const chatId = doc.data().chatId;
              if (chatId) {
                const message = `<b>${title}</b>\n\n${body}`;
                telegramPromises.push(sendTelegramMessage(botToken, chatId, message));
              }
            });
            
            if (telegramPromises.length > 0) {
              const telegramResults = await Promise.allSettled(telegramPromises);
              const telegramSuccess = telegramResults.filter(r => r.status === 'fulfilled' && r.value === true).length;
              console.log(`Telegram: ${telegramSuccess}/${telegramPromises.length} gönderildi`);
            }
          }
        }
      } catch (telegramError) {
        console.error('Telegram bildirim hatası:', telegramError);
      }
      
      // 2. FCM BİLDİRİMLERİ (Yedek - desktop/Android için)
      let tokensQuery;
      if (targetPins && targetPins.length > 0) {
        tokensQuery = db.collection('fcmTokens').where('pin', 'in', targetPins);
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
