// content_script.js - wstrzykiwany na stronę do zaznaczania obszaru

(() => {
    // Unikaj ponownego wstrzykiwania skryptu, jeśli już istnieje
    if (document.getElementById('screenshot-selection-overlay')) {
        return;
    }

    // Tworzenie elementów DOM
    const overlay = document.createElement('div');
    const selectionBox = document.createElement('div');
    const tooltip = document.createElement('div');

    // Funkcja czyszcząca - usuwa wszystkie elementy i nasłuchiwania
    const cleanup = () => {
        document.removeEventListener('keydown', handleEscape);
        if (document.body.contains(overlay)) {
            document.body.removeChild(overlay);
        }
    };

    // Obsługa klawisza Escape do anulowania
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            cleanup();
        }
    };
    
    document.addEventListener('keydown', handleEscape);

    // Stylizacja nakładki
    Object.assign(overlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        zIndex: '2147483647', // Najwyższy możliwy z-index
        cursor: 'crosshair',
        backgroundColor: 'rgba(0, 0, 0, 0.5)' // Przyciemnienie tła
    });
    overlay.id = 'screenshot-selection-overlay';
    
    // Stylizacja pola zaznaczenia
    Object.assign(selectionBox.style, {
        position: 'absolute',
        border: '2px dashed #ffffff',
        backgroundColor: 'rgba(0, 123, 255, 0.3)',
        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)', // Efekt "dziury" w przyciemnieniu
        display: 'none'
    });

    // Stylizacja podpowiedzi
    Object.assign(tooltip.style, {
        position: 'fixed',
        top: '10px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '8px 16px',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        color: 'white',
        borderRadius: '8px',
        fontSize: '14px',
        fontFamily: 'sans-serif',
        zIndex: '2147483647'
    });
    tooltip.textContent = 'Naciśnij Esc, aby anulować';

    overlay.appendChild(selectionBox);
    overlay.appendChild(tooltip);
    document.body.appendChild(overlay);

    let startX, startY, isDrawing = false;

    // Obsługa zdarzeń myszy
    overlay.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        isDrawing = true;
        startX = e.clientX;
        startY = e.clientY;
        selectionBox.style.left = `${startX}px`;
        selectionBox.style.top = `${startY}px`;
        selectionBox.style.width = '0px';
        selectionBox.style.height = '0px';
        selectionBox.style.display = 'block';
        selectionBox.style.boxShadow = 'none'; // Usuń cień po rozpoczęciu rysowania
    });

    overlay.addEventListener('mousemove', (e) => {
        if (!isDrawing) return;
        e.stopPropagation();

        const currentX = e.clientX;
        const currentY = e.clientY;

        const width = currentX - startX;
        const height = currentY - startY;

        selectionBox.style.width = `${Math.abs(width)}px`;
        selectionBox.style.height = `${Math.abs(height)}px`;
        selectionBox.style.left = `${width > 0 ? startX : currentX}px`;
        selectionBox.style.top = `${height > 0 ? startY : currentY}px`;
    });

    overlay.addEventListener('mouseup', (e) => {
        if (!isDrawing) return;
        isDrawing = false;
        e.stopPropagation();

        const rect = selectionBox.getBoundingClientRect();
        
        cleanup(); // Usuń nakładkę i słuchacze zdarzeń

        // Jeśli zaznaczenie jest zbyt małe, zignoruj
        if (rect.width < 5 || rect.height < 5) return;
        
        // Mnożymy przez devicePixelRatio dla ekranów o wysokiej gęstości (np. Retina)
        const dpr = window.devicePixelRatio || 1;
        chrome.runtime.sendMessage({
            action: 'captureArea',
            area: {
                x: rect.left * dpr,
                y: rect.top * dpr,
                width: rect.width * dpr,
                height: rect.height * dpr
            }
        });
    });

})();