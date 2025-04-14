/**
 * Belirtilen aralıkta rastgele bir sayı üretir
 * @param {number} min - Minimum değer (dahil)
 * @param {number} max - Maksimum değer (dahil)
 * @returns {number} - Rastgele sayı
 */
function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  
  /**
   * Belirtilen süre kadar bekler
   * @param {number} ms - Milisaniye cinsinden bekleme süresi
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Hata mesajını biçimlendirir
   * @param {Error} error - Hata nesnesi
   * @returns {string} - Biçimlendirilmiş hata mesajı
   */
  function formatError(error) {
    return {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
  }
  
  module.exports = {
    getRandomInt,
    sleep,
    formatError
  };