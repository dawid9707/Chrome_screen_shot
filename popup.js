document.addEventListener('DOMContentLoaded', () => {
    const btnPng = document.getElementById('format-png');
    const btnJpg = document.getElementById('format-jpg');
    const buttons = [btnPng, btnJpg];

    // Funkcja do ustawiania aktywnego przycisku
    const setActiveFormatButton = (format) => {
        buttons.forEach(btn => {
            if (btn.id === `format-${format}`) {
                btn.classList.add('selected');
            } else {
                btn.classList.remove('selected');
            }
        });
    };
    
    // Wczytaj zapisaną preferencję formatu
    chrome.storage.sync.get(['captureFormat'], (result) => {
        const savedFormat = result.captureFormat || 'png';
        setActiveFormatButton(savedFormat);
    });

    // Zapisz preferencję i zaktualizuj UI przy zmianie
    btnPng.addEventListener('click', () => {
        chrome.storage.sync.set({ captureFormat: 'png' });
        setActiveFormatButton('png');
    });
    btnJpg.addEventListener('click', () => {
        chrome.storage.sync.set({ captureFormat: 'jpg' });
        setActiveFormatButton('jpg');
    });

    // Dodaj listenery do przycisków akcji
    document.getElementById('capture-visible').addEventListener('click', () => handleCapture('captureVisible'));
    document.getElementById('capture-full').addEventListener('click', () => handleCapture('captureFull'));
    document.getElementById('capture-area').addEventListener('click', () => handleCapture('initiateAreaSelection'));
});

function getSelectedFormat() {
    return document.querySelector('.format-btn.selected').id.split('-')[1];
}

function handleCapture(action) {
    const format = getSelectedFormat();
    chrome.runtime.sendMessage({ action, format }, () => {
        if (chrome.runtime.lastError) {
            // Obsługa błędu, jeśli jest potrzebna
            console.error(chrome.runtime.lastError.message);
        }
        // Zamknij okienko dla akcji, które tego wymagają
        if (action === 'captureFull' || action === 'initiateAreaSelection') {
            window.close();
        }
    });
}