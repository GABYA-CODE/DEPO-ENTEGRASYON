// Deneme taleplerini temizleme scripti
// Bu scripti browser console'da çalıştırın (F12 -> Console)

async function temizleTalepler() {
  // Saklanacak talepler (görseldeki 3 talep)
  const saklanacakTalepler = [
    "Maket bıcağı ucu",
    "2 kutu 80 kum flap", 
    "M8 klavuz"
  ];
  
  try {
    console.log("Talepler kontrol ediliyor...");
    
    const materialReqCol = collection(window.db, "materialRequests");
    const snapshot = await getDocs(materialReqCol);
    
    let silinecekSayisi = 0;
    let saklanacakSayisi = 0;
    
    console.log(`Toplam ${snapshot.size} talep bulundu.`);
    
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const malzemeAdi = data.materialName || "";
      
      // Bu talep saklanacak listede mi?
      if (saklanacakTalepler.includes(malzemeAdi)) {
        console.log(`✅ Saklanıyor: ${malzemeAdi} (${data.quantity} adet)`);
        saklanacakSayisi++;
      } else {
        console.log(`❌ Siliniyor: ${malzemeAdi} (${data.quantity} adet)`);
        await deleteDoc(doc(window.db, "materialRequests", docSnap.id));
        silinecekSayisi++;
      }
    }
    
    console.log(`\n✅ İşlem tamamlandı!`);
    console.log(`Saklanan: ${saklanacakSayisi} talep`);
    console.log(`Silinen: ${silinecekSayisi} talep`);
    
    // Sayfayı yenile
    if (typeof loadMaterialRequests === 'function') {
      loadMaterialRequests();
    }
    
    alert(`İşlem tamamlandı!\nSaklanan: ${saklanacakSayisi}\nSilinen: ${silinecekSayisi}`);
    
  } catch (error) {
    console.error("Hata:", error);
    alert("Hata: " + error.message);
  }
}

// Scripti çalıştır
temizleTalepler();
