// DOM references (initialized on DOMContentLoaded)
let wordsListElement;
let notificationElement;
let loadingOverlay;
let wordsLoading;

// state
let currentUserId = null;
let isRecording = false;
let recognition = null;
let currentWords = [];
let currentCardIndex = 0;
let isEditingMode = false;
let editingWordId = null;
let fieldChangedState = {}; // {0: false, 1: false, 2: false} - было ли изменено поле
let changeTimers = {}; // Таймеры для сохранения изменений


// API base — используем origin текущей страницы
const API_BASE_URL = 'https://dict.lllang.site';

console.log('API Base URL:', API_BASE_URL);
console.log('Current location:', window.location.protocol + '//' + window.location.host);

// --- Helpers ---
function showNotification(message, type='success') {
    if (!notificationElement) return;
    notificationElement.textContent = message;
    notificationElement.className = `notification ${type} show`;
    setTimeout(() => {
        notificationElement.classList.remove('show');
    }, 3500);
}

function escapeHTML(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isSameOrigin(url) {
    try {
        const u = new URL(url, window.location.href);
        return u.origin === window.location.origin;
    } catch (e) {
        return false;
    }
}

function getPartOfSpeechName(code) {
    const names = {
        'noun': 'Существительное',
        'verb': 'Глагол',
        'adjective': 'Прилагательное',
        'adverb': 'Наречие',
        'other': 'Другое'
    };
    return names[code] || code || '';
}

function getPartOfSpeechAbbreviation(code) {
    const abbreviations = {
        'noun': 'сущ',
        'verb': 'гл',
        'adjective': 'прил',
        'adverb': 'нар',
        'other': 'др'
    };
    return abbreviations[code] || 'др';
}

// Инициализация системы переводов
function initializeMultipleTranslations() {
    const partOfSpeechSelect = document.getElementById('partOfSpeech');
    const partOfSpeechDisplay = document.getElementById('partOfSpeechDisplay');
    const translationsContainer = document.getElementById('translationsContainer');

    if (!partOfSpeechSelect || !translationsContainer) return;

    // Очищаем контейнер и добавляем одно пустое поле без бейджа
    translationsContainer.innerHTML = '';
    addInitialTranslationField();

    // Обработчик изменения части речи - пересчитываем кнопки
    partOfSpeechSelect.addEventListener('change', function() {
        updateDynamicBadge();
        updateTranslationAddButtons();
    });

    // Также обновляем при клике на display
    if (partOfSpeechDisplay) {
        partOfSpeechDisplay.addEventListener('click', function() {
            setTimeout(() => {
                updateDynamicBadge();
                updateTranslationAddButtons();
            }, 10);
        });
    }

    // Слушаем ввод в поле слова для обновления кнопок
    const wordInput = document.getElementById('newWord');
    if (wordInput) {
        wordInput.addEventListener('input', updateTranslationAddButtons);
    }

    // Слушаем ввод в поля переводов
    translationsContainer.addEventListener('input', function(e) {
        if (e.target.classList.contains('translation-input')) {
            handleTranslationInput(e.target);
        }
    });

    // Инициализируем отслеживание изменений
    resetChangeTracking();
}

// Обработка ввода в поле перевода
function handleTranslationInput(inputElement) {
    const wrapper = inputElement.closest('.translation-input-wrapper');
    const fieldIndex = Array.from(wrapper.parentNode.children).indexOf(wrapper);

    // Очищаем предыдущий таймер для этого поля
    if (changeTimers[fieldIndex]) {
        clearTimeout(changeTimers[fieldIndex]);
    }

    // Устанавливаем таймер на 1 секунду
    changeTimers[fieldIndex] = setTimeout(() => {
        // Отмечаем поле как измененное
        fieldChangedState[fieldIndex] = true;
        updateTranslationAddButtons();
    }, 1000);

    updateTranslationAddButtons();
}


// Сброс отслеживания изменений
function resetChangeTracking() {
    fieldChangedState = {};
    changeTimers = {};
}

function updateDynamicBadge() {
    const partOfSpeechSelect = document.getElementById('partOfSpeech');
    const currentPartOfSpeech = partOfSpeechSelect.value;
    const abbreviation = getPartOfSpeechAbbreviation(currentPartOfSpeech);

    // Обновляем только динамический бейдж (последнее поле, если оно третье)
    const translationsContainer = document.getElementById('translationsContainer');
    const fields = translationsContainer.querySelectorAll('.translation-input-wrapper');

    if (fields.length === 3) {
        const lastField = fields[2];
        const dynamicBadge = lastField.querySelector('.part-of-speech-badge.dynamic');
        if (dynamicBadge) {
            dynamicBadge.textContent = abbreviation;
            dynamicBadge.setAttribute('data-part-of-speech', currentPartOfSpeech);
        }
    }
}


// Добавление начального поля
function addInitialTranslationField() {
    const translationsContainer = document.getElementById('translationsContainer');

    const wrapper = document.createElement('div');
    wrapper.className = 'translation-input-wrapper';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'translation-input';
    input.placeholder = 'Введите перевод';
    input.autocomplete = 'off';

    input.addEventListener('input', function() {
        handleTranslationInput(this);
    });

    wrapper.appendChild(input);
    translationsContainer.appendChild(wrapper);

    // Инициализируем состояние для этого поля
    fieldChangedState[0] = false;
}


// Основная логика отображения кнопок
function updateTranslationAddButtons() {
    const translationsContainer = document.getElementById('translationsContainer');
    const partOfSpeechSelect = document.getElementById('partOfSpeech');
    const wordInput = document.getElementById('newWord');
    const currentPartOfSpeech = partOfSpeechSelect.value;
    const hasWord = wordInput.value.trim() !== '';

    // Проверяем количество полей
    const fields = translationsContainer.querySelectorAll('.translation-input-wrapper');
    const fieldsCount = fields.length;

    // Удаляем все кнопки со всех полей
    fields.forEach(field => {
        const addBtn = field.querySelector('.add-translation-btn');
        const removeBtn = field.querySelector('.remove-translation-btn');
        if (addBtn) addBtn.remove();
        if (removeBtn) removeBtn.remove();
    });

    // Для каждого поля применяем логику
    fields.forEach((field, index) => {
        // ПЕРВОЕ ПОЛЕ
        if (index === 0) {
            if (fieldsCount === 1) {
                // Только одно поле - проверяем изменение части речи И текста
                const partOfSpeechChanged = currentPartOfSpeech !== '';
                const textChanged = fieldChangedState[0] || false;

                if (partOfSpeechChanged && textChanged && hasWord) {
                    addAddButton(field, index);
                }
                // Иначе ничего не показываем
            }
            // Если есть второе или третье поле - ничего не показываем
            return;
        }

        // ВТОРОЕ ПОЛЕ
        if (index === 1) {
            if (fieldsCount === 2) {
                // Два поля
                const isChanged = fieldChangedState[1] || false;
                if (isChanged) {
                    addAddButton(field, index);
                } else {
                    addRemoveButton(field, index);
                }
            } else if (fieldsCount === 3) {
                // Три поля - всегда минус
                addRemoveButton(field, index);
            }
            return;
        }

        // ТРЕТЬЕ ПОЛЕ (индекс 2)
        if (index === 2 && fieldsCount === 3) {
            // Всегда минус
            addRemoveButton(field, index);
        }
    });
}


function addAddButton(field, index) {
    // Проверяем, есть ли уже кнопка плюса
    if (field.querySelector('.add-translation-btn')) return;

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'add-translation-btn';
    addBtn.innerHTML = '<i class="fas fa-plus"></i>';
    addBtn.title = 'Добавить еще один перевод';

    addBtn.addEventListener('click', function() {
        addTranslationField();
    });

    field.appendChild(addBtn);
}

// Создание нового поля перевода
function createNewTranslationField(isThirdField, partOfSpeech) {
    const translationsContainer = document.getElementById('translationsContainer');

    const wrapper = document.createElement('div');
    wrapper.className = 'translation-input-wrapper';

    if (isThirdField && partOfSpeech) {
        // Третье поле сразу с динамическим бейджем
        const badge = document.createElement('div');
        badge.className = 'part-of-speech-badge dynamic';
        badge.textContent = getPartOfSpeechAbbreviation(partOfSpeech);
        badge.setAttribute('data-part-of-speech', partOfSpeech);
        wrapper.appendChild(badge);

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'translation-input';
        input.placeholder = 'Введите перевод';
        input.autocomplete = 'off';

        input.addEventListener('input', function() {
            handleTranslationInput(this);
        });

        wrapper.appendChild(input);

        // Для третьего поля сразу добавляем минус
        const fieldIndex = Array.from(translationsContainer.children).length;
        addRemoveButton(wrapper, fieldIndex);
    } else {
        // Второе поле без бейджа
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'translation-input';
        input.placeholder = 'Введите перевод';
        input.autocomplete = 'off';

        input.addEventListener('input', function() {
            handleTranslationInput(this);
        });

        wrapper.appendChild(input);
    }

    translationsContainer.appendChild(wrapper);

    // Инициализируем состояние для нового поля
    const fieldIndex = Array.from(translationsContainer.children).length - 1;
    fieldChangedState[fieldIndex] = false;
}


// Функция добавления кнопки минуса
function addRemoveButton(field, index) {
    // Проверяем, есть ли уже кнопка минуса
    if (field.querySelector('.remove-translation-btn')) return;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-translation-btn';
    removeBtn.innerHTML = '<i class="fas fa-minus"></i>';
    removeBtn.title = 'Удалить перевод';

    removeBtn.addEventListener('click', function() {
        removeTranslationField(field, index);
    });

    field.appendChild(removeBtn);
}

// Удаление поля перевода
function removeTranslationField(field, index) {
    const translationsContainer = document.getElementById('translationsContainer');
    const fields = translationsContainer.querySelectorAll('.translation-input-wrapper');

    // Не удаляем если только одно поле
    if (fields.length <= 1) return;

    // Удаляем поле
    field.remove();

    // Обновляем состояние изменений после удаления
    updateChangeStateAfterRemoval(index);

    // Обновляем кнопки
    updateTranslationAddButtons();
}


// Обновление состояния изменений после удаления поля
function updateChangeStateAfterRemoval(removedIndex) {
    const translationsContainer = document.getElementById('translationsContainer');
    const fields = translationsContainer.querySelectorAll('.translation-input-wrapper');

    // Создаем новое состояние
    const newState = {};

    // Обрабатываем каждое оставшееся поле
    fields.forEach((field, newIndex) => {
        // Первое поле сохраняет свое состояние
        if (newIndex === 0) {
            newState[newIndex] = fieldChangedState[0] || false;
        }
        // Для всех остальных полей:
        else {
            // Если это поле было "затронуто" удалением (стало последним или изменило позицию)
            // сбрасываем его состояние
            newState[newIndex] = false;
        }
    });

    fieldChangedState = newState;
    // Очищаем все таймеры, кроме первого поля
    Object.keys(changeTimers).forEach(key => {
        const index = parseInt(key);
        if (index > 0) { // Очищаем все таймеры кроме первого поля
            clearTimeout(changeTimers[key]);
            delete changeTimers[key];
        }
    });
}

// Добавление поля перевода (существующая функция, оставляем логику бейджей)
function addTranslationField() {
    const translationsContainer = document.getElementById('translationsContainer');
    const partOfSpeechSelect = document.getElementById('partOfSpeech');
    const wordInput = document.getElementById('newWord');

    // Проверяем условия: введено слово и выбрана часть речи
    if (!wordInput.value.trim()) {
        showNotification('Сначала введите слово', 'error');
        return;
    }

    if (!partOfSpeechSelect.value) {
        showNotification('Сначала выберите часть речи', 'error');
        return;
    }

    const currentPartOfSpeech = partOfSpeechSelect.value;
    const abbreviation = getPartOfSpeechAbbreviation(currentPartOfSpeech);

    // Подсчитываем текущее количество полей перевода
    const currentFields = translationsContainer.querySelectorAll('.translation-input-wrapper');
    if (currentFields.length >= 3) return;

    // Удаляем кнопку плюсика с последнего поля
    const lastField = currentFields[currentFields.length - 1];
    const existingAddBtn = lastField.querySelector('.add-translation-btn');
    if (existingAddBtn) {
        existingAddBtn.remove();
    }

    // Если это добавление второго поля (будет всего 2 поля)
    if (currentFields.length === 1) {
        // Добавляем бейдж к текущему полю
        const badge = document.createElement('div');
        badge.className = 'part-of-speech-badge';
        badge.textContent = abbreviation;
        badge.setAttribute('data-part-of-speech', currentPartOfSpeech);
        lastField.insertBefore(badge, lastField.firstChild);

        // Создаем новое поле без бейджа
        createNewTranslationField(false, null);
    }
    // Если это добавление третьего поля (будет всего 3 поля)
    else if (currentFields.length === 2) {
        // Добавляем бейдж к текущему полю
        const badge = document.createElement('div');
        badge.className = 'part-of-speech-badge';
        badge.textContent = abbreviation;
        badge.setAttribute('data-part-of-speech', currentPartOfSpeech);
        lastField.insertBefore(badge, lastField.firstChild);

        // Создаем третье поле с динамическим бейджем
        createNewTranslationField(true, currentPartOfSpeech);
    }

    // Обновляем состояние кнопок
    updateTranslationAddButtons();
}

// Очистка полей переводов
function clearTranslationFields() {
    const translationsContainer = document.getElementById('translationsContainer');
    translationsContainer.innerHTML = '';
    addInitialTranslationField(); // Добавляем начальное поле

    // Очищаем таймеры
    Object.values(changeTimers).forEach(timer => {
        if (timer) clearTimeout(timer);
    });
    changeTimers = {};
    resetChangeTracking();
}


// Заполнение полей переводов при редактировании (существующая функция)
function populateTranslationFields(translations, partOfSpeech) {
    clearTranslationFields();

    if (!translations || translations.length === 0) return;

    // Если translations - строка, преобразуем в массив
    if (typeof translations === 'string') {
        translations = [translations];
    }

    // Удаляем начальное поле
    const translationsContainer = document.getElementById('translationsContainer');
    translationsContainer.innerHTML = '';

    // Сбрасываем отслеживание изменений
    resetChangeTracking();

    // Создаем поля для каждого перевода (максимум 3)
    const maxFields = Math.min(translations.length, 3);
    const abbreviation = getPartOfSpeechAbbreviation(partOfSpeech);

    for (let i = 0; i < maxFields; i++) {
        const wrapper = document.createElement('div');
        wrapper.className = 'translation-input-wrapper';

        // Первое поле без бейджа, остальные с бейджем
        if (i > 0) {
            const badge = document.createElement('div');
            badge.className = 'part-of-speech-badge' + (i === maxFields - 1 && maxFields === 3 ? ' dynamic' : '');
            badge.textContent = abbreviation;
            badge.setAttribute('data-part-of-speech', partOfSpeech);
            wrapper.appendChild(badge);
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'translation-input';
        input.value = translations[i];
        input.autocomplete = 'off';

        input.addEventListener('input', function() {
            handleTranslationInput(this);
        });

        wrapper.appendChild(input);
        translationsContainer.appendChild(wrapper);

        // Инициализируем состояние для этого поля (предполагаем, что эти значения не изменены)
        fieldChangedState[i] = false;
    }

    // Обновляем кнопки
    updateTranslationAddButtons();
}

// --- Load words ---
async function loadWords() {
    if (!currentUserId) {
        showNotification('user_id не определен', 'error');
        return;
    }

    console.info('loadWords: user_id=', currentUserId);
    if (wordsLoading) wordsLoading.style.display = 'flex';

    const url = `${API_BASE_URL}/api/words?user_id=${currentUserId}`;
    try {
        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' },
            credentials: isSameOrigin(API_BASE_URL) ? 'include' : 'omit'
        });

        console.info('loadWords: status', response.status);

        if (response.status === 204) {
            console.info('loadWords: no content (204), words list is empty');
            currentWords = [];
            displayCurrentCard();
            return;
}
        const text = await response.text();

        if (!response.ok) {
            console.error('loadWords: server responded with error', response.status, text);
            throw new Error(`Ошибка сервера (${response.status})`);
        }

        let data;
        try {
            data = JSON.parse(text);
            console.debug('loadWords: raw data', data);
            console.debug('Тип данных:', typeof data, 'Является ли массивом?', Array.isArray(data));

            // Данные приходят как массив
            if (Array.isArray(data)) {
                // Данные пришли в виде массива слов
                console.log('Получен массив слов, длина:', data.length);
                currentWords = data;
            }
            else if (data && typeof data === 'object') {
                // Данные пришли в виде объекта с ключом user_id (старый формат)
                console.log('Получен объект, ключи:', Object.keys(data));
                const userIdKey = Number(currentUserId);

                // Пробуем найти данные по ключу
                if (data[userIdKey]) {
                    currentWords = data[userIdKey];
                }
                // Если не нашли, пробуем перебрать все ключи
                else {
                    // Ищем любой ключ, который может быть user_id
                    for (const key in data) {
                        if (Array.isArray(data[key])) {
                            currentWords = data[key];
                            console.log('Нашли слова по ключу:', key);
                            break;
                        }
                    }
                }
            } else {
                currentWords = [];
            }

            console.debug('loadWords: extracted words', currentWords);
        } catch (e) {
            console.error('Ошибка парсинга JSON:', e);
            throw new Error('Неверный формат JSON от сервера');
        }

        // Преобразуем структуру переводов для удобства использования
        if (currentWords && currentWords.length > 0) {
            currentWords = currentWords.map(word => {
                if (!word) return null;
                return transformWordStructure(word);
            }).filter(word => word !== null); // Удаляем null значения
        } else {
            currentWords = [];
        }

        console.debug('loadWords: transformed words', currentWords);

        // Сортируем слова по алфавиту
        currentWords.sort((a, b) => {
            const wordA = (a.word || '').toLowerCase();
            const wordB = (b.word || '').toLowerCase();
            return wordA.localeCompare(wordB);
        });

        // После загрузки и сортировки
        if (currentCardIndex >= currentWords.length) {
            currentCardIndex = Math.max(0, currentWords.length - 1);
        }

        displayCurrentCard();

    } catch (err) {
        console.error('loadWords error:', err);
        showNotification('Ошибка загрузки слов. Проверьте консоль.', 'error');
    } finally {
        if (wordsLoading) wordsLoading.style.display = 'none';
    }
}

// Функция для преобразования структуры слова
function transformWordStructure(word) {
    // Если уже есть поле translationsArray (уже преобразовано), пропускаем
    if (word.translationsArray) return word;

    const result = { ...word };

    // Извлекаем переводы из нового формата
    if (word.translations && typeof word.translations === 'object') {
        const translationsObj = word.translations;
        const translationsArray = [];

        // Сортируем ключи (1, 2, 3...)
        const sortedKeys = Object.keys(translationsObj).sort((a, b) => parseInt(a) - parseInt(b));

        sortedKeys.forEach(key => {
            if (translationsObj[key] && translationsObj[key].translation) {
                translationsArray.push(translationsObj[key].translation);
            }
        });

        // Сохраняем как массив для удобства использования
        result.translationsArray = translationsArray;
        // Также сохраняем оригинальную структуру переводов для отправки на сервер
        result.originalTranslations = translationsObj;
    } else {
        // Для обратной совместимости со старым форматом
        result.translationsArray = Array.isArray(word.translation) ?
            word.translation :
            (word.translation ? [word.translation] : []);
    }

    return result;
}


// Функция для преобразования структуры слова
function transformWordStructure(word) {
    // Если уже есть поле translationsArray (уже преобразовано), пропускаем
    if (word.translationsArray) return word;

    const result = { ...word };

    // Извлекаем переводы из нового формата
    if (word.translations && typeof word.translations === 'object') {
        const translationsObj = word.translations;
        const translationsArray = [];

        // Сортируем ключи (1, 2, 3...)
        const sortedKeys = Object.keys(translationsObj).sort((a, b) => parseInt(a) - parseInt(b));

        sortedKeys.forEach(key => {
            if (translationsObj[key] && translationsObj[key].translation) {
                translationsArray.push(translationsObj[key].translation);
            }
        });

        // Сохраняем как массив для удобства использования
        result.translationsArray = translationsArray;
        // Также сохраняем исходный объект переводов для отправки на сервер
        result.originalTranslations = translationsObj;
    } else {
        // Для обратной совместимости со старым форматом
        result.translationsArray = Array.isArray(word.translation) ?
            word.translation :
            (word.translation ? [word.translation] : []);
    }

    return result;
}


function initializeCardMenu() {
    const wordCard = document.getElementById('wordCard');
    if (!wordCard) return;

    const menuTrigger = wordCard.querySelector('.menu-trigger');
    const menuIcon = wordCard.querySelector('.menu-icon');
    const menuBookmarks = wordCard.querySelector('.menu-bookmarks');

    // Переключатель меню
    menuTrigger.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();

        const isActive = !this.classList.contains('active');

        if (isActive) {
            // Открываем меню: карандаш → красный крестик
            this.classList.add('active');
            menuIcon.className = 'menu-icon fas fa-times'; // Меняем на крестик
            menuBookmarks.classList.add('active');
        } else {
            // Закрываем меню: крестик → карандаш
            this.classList.remove('active');
            menuIcon.className = 'menu-icon fas fa-pencil-alt'; // Возвращаем карандаш
            menuBookmarks.classList.remove('active');
        }
    });

    // Обработчики для кнопок-закладок
    wordCard.addEventListener('click', function(e) {
        // Обработчик для кнопки редактирования
        const editBtn = e.target.closest('.edit-bookmark');
        if (editBtn) {
            const wordId = editBtn.getAttribute('data-word-id');
            if (wordId) {
                closeCardMenu();
                setTimeout(() => enterEditMode(wordId), 100);
            }
            return;
        }

        // Обработчик для кнопки удаления
        const deleteBtn = e.target.closest('.delete-bookmark');
        if (deleteBtn) {
            const wordId = deleteBtn.getAttribute('data-word-id');
            if (wordId) {
                closeCardMenu();
                setTimeout(() => deleteWord(wordId), 100);
            }
            return;
        }

        // Обработчик для AI кнопки
        const aiBtn = e.target.closest('.ai-bookmark');
        if (aiBtn) {
            closeCardMenu();
            setTimeout(() => {
                showNotification('AI функция находится в разработке', 'success');
            }, 100);
            return;
        }
    });

    // Закрытие меню при клике вне карточки
    document.addEventListener('click', function(e) {
        if (!wordCard.contains(e.target)) {
            closeCardMenu();
        }
    });
}

// Функция для закрытия меню
function closeCardMenu() {
    const wordCard = document.getElementById('wordCard');
    if (!wordCard) return;

    const menuTrigger = wordCard.querySelector('.menu-trigger');
    const menuIcon = wordCard.querySelector('.menu-icon');
    const menuBookmarks = wordCard.querySelector('.menu-bookmarks');

    if (menuTrigger && menuTrigger.classList.contains('active')) {
        menuTrigger.classList.remove('active');
        menuIcon.className = 'menu-icon fas fa-pencil-alt';
        menuBookmarks.classList.remove('active');
    }
}

// --- Display current card ---
function displayCurrentCard() {
    const wordCard = document.getElementById('wordCard');
    const emptyState = document.getElementById('emptyState');
    const cardCounter = document.getElementById('cardCounter');

    if (currentWords.length === 0) {
        if (wordCard) wordCard.style.display = 'none';
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    if (wordCard) wordCard.style.display = 'block';
    if (emptyState) emptyState.style.display = 'none';

    const currentWord = currentWords[currentCardIndex];
    console.debug('Displaying word:', currentWord);

    // Обновляем содержимое карточки
    const cardWordElement = document.getElementById('cardWord');
    const cardTranslationElement = document.getElementById('cardTranslation');
    const cardPosElement = document.getElementById('cardPos');

    if (cardWordElement) cardWordElement.textContent = currentWord.word || '';

    // Используем translationsArray для отображения
    const translations = currentWord.translationsArray || [];
    const hasMultipleTranslations = translations.length > 1;

    // Очищаем элемент перевода
    if (cardTranslationElement) {
        cardTranslationElement.innerHTML = '';
        cardTranslationElement.className = 'word-translation';

        if (translations.length === 0) {
            cardTranslationElement.style.display = 'none';
        } else if (translations.length === 1) {
            // Один перевод - отображаем как обычно
            cardTranslationElement.textContent = translations[0];
            cardTranslationElement.style.display = 'block';

            // Отображаем часть речи отдельно
            if (cardPosElement) {
                // Получаем часть речи из оригинальной структуры
                let partOfSpeech = '';
                if (currentWord.originalTranslations && currentWord.originalTranslations['1']) {
                    partOfSpeech = currentWord.originalTranslations['1'].part_of_speech;
                } else if (currentWord.part_of_speech) {
                    partOfSpeech = currentWord.part_of_speech;
                }
                cardPosElement.textContent = getPartOfSpeechName(partOfSpeech || '');
                cardPosElement.style.display = 'block';
            }
        } else {
            // Несколько переводов - отображаем в столбец с новой структурой
            cardTranslationElement.classList.add('multiple');

            const translationList = document.createElement('ul');
            translationList.className = 'translation-list';

            translations.forEach((translation, index) => {
                const translationItem = document.createElement('li');
                translationItem.className = 'translation-item';

                // Номер
                const numberSpan = document.createElement('span');
                numberSpan.className = 'translation-number';
                numberSpan.textContent = `${index + 1}.`;

                // Контейнер для части речи и перевода
                const contentDiv = document.createElement('div');
                contentDiv.className = 'translation-content';

                // Часть речи (сокращение с точкой)
                const posSpan = document.createElement('span');
                posSpan.className = 'translation-pos';

                // Получаем часть речи для этого перевода
                let partOfSpeech = '';
                if (currentWord.originalTranslations && currentWord.originalTranslations[String(index + 1)]) {
                    partOfSpeech = currentWord.originalTranslations[String(index + 1)].part_of_speech;
                } else if (currentWord.part_of_speech) {
                    partOfSpeech = currentWord.part_of_speech;
                }

                const abbreviation = getPartOfSpeechAbbreviation(partOfSpeech || '');
                posSpan.textContent = abbreviation ? `${abbreviation}.` : '';

                // Перевод (в той же строке)
                const textSpan = document.createElement('span');
                textSpan.className = 'translation-text';
                textSpan.textContent = translation;

                contentDiv.appendChild(posSpan);
                contentDiv.appendChild(textSpan);

                translationItem.appendChild(numberSpan);
                translationItem.appendChild(contentDiv);
                translationList.appendChild(translationItem);
            });

            cardTranslationElement.appendChild(translationList);
            cardTranslationElement.style.display = 'block';

            // Скрываем отдельную часть речи, так как она теперь в той же строке
            if (cardPosElement) {
                cardPosElement.style.display = 'none';
            }
        }
    }

    // Устанавливаем data-word-id для кнопок-закладок
    const editBookmark = wordCard.querySelector('.edit-bookmark');
    const deleteBookmark = wordCard.querySelector('.delete-bookmark');
    const aiBookmark = wordCard.querySelector('.ai-bookmark');

    if (editBookmark) editBookmark.setAttribute('data-word-id', currentWord.id || currentWord.word_id);
    if (deleteBookmark) deleteBookmark.setAttribute('data-word-id', currentWord.id || currentWord.word_id);
    if (aiBookmark) aiBookmark.setAttribute('data-word-id', currentWord.id || currentWord.word_id);

    // Закрываем меню при смене карточки
    closeCardMenu();

    // Контекст
    const contextContainer = document.getElementById('cardContextContainer');
    const contextElement = document.getElementById('cardContext');
    if (currentWord.context && contextContainer && contextElement) {
        contextElement.textContent = currentWord.context;
        contextContainer.style.display = 'block';
    } else if (contextContainer) {
        contextContainer.style.display = 'none';
    }

    // Аудио
    const audioContainer = document.getElementById('cardAudioContainer');
    const audioBtn = document.getElementById('playAudioBtn');
    if (currentWord.audio && audioContainer && audioBtn) {
        audioBtn.onclick = () => playAudio(currentWord.audio);
        audioBtn.disabled = false;
        audioContainer.style.display = 'block';
    } else if (audioContainer) {
        audioContainer.style.display = 'none';
    }

    // Управление индикатором публичного слова
    if (wordCard) {
        // Удаляем старый индикатор
        const existingIndicator = wordCard.querySelector('.public-word-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }

        // Создаем новый индикатор если слово публичное
        if (currentWord.is_public) {
            const publicIndicator = document.createElement('div');
            publicIndicator.className = 'public-word-indicator';
            publicIndicator.innerHTML = '<i class="fas fa-globe" title="Публичное слово - видно другим пользователям"></i>';

            const cardContent = wordCard.querySelector('.word-card-content');
            if (cardContent) {
                cardContent.appendChild(publicIndicator);
            }
        }
    }

    // Счетчик
    if (cardCounter) {
        cardCounter.textContent = `${currentCardIndex + 1} / ${currentWords.length}`;
    }

    // Обновляем состояние кнопок навигации
    const prevBtn = document.getElementById('prevWordBtn');
    const nextBtn = document.getElementById('nextWordBtn');
    if (prevBtn) prevBtn.disabled = currentCardIndex === 0;
    if (nextBtn) nextBtn.disabled = currentCardIndex === currentWords.length - 1;

    // Анимация появления
    if (wordCard) {
        wordCard.classList.remove('fade-out');
        wordCard.classList.add('fade-in');
    }
}

// --- Play audio ---
function playAudio(audioUrl) {
    const audioBtn = document.getElementById('playAudioBtn');
    const icon = audioBtn.querySelector('i');

    try {
        // Исправляем протокол, если URL начинается с http://
        let fixedAudioUrl = audioUrl;
        if (audioUrl.startsWith('http://')) {
            fixedAudioUrl = audioUrl.replace('http://', 'https://');
        }

        const audio = new Audio(fixedAudioUrl);
        audioBtn.disabled = true;
        icon.className = 'fas fa-volume-up';

        audio.play().then(() => {
            audio.onended = () => {
                audioBtn.disabled = false;
                icon.className = 'fas fa-play';
            };
        }).catch(error => {
            console.error('Error playing audio:', error);
            showNotification('Ошибка воспроизведения аудио', 'error');
            audioBtn.disabled = false;
            icon.className = 'fas fa-play';
        });
    } catch (error) {
        console.error('Error with audio:', error);
        showNotification('Ошибка с аудиофайлом', 'error');
        audioBtn.disabled = false;
        icon.className = 'fas fa-play';
    }
}

// --- Navigation functions ---
function nextWord() {
    if (currentCardIndex < currentWords.length - 1) {
        const wordCard = document.getElementById('wordCard');
        wordCard.classList.remove('fade-in');
        wordCard.classList.add('fade-out');

        setTimeout(() => {
            currentCardIndex++;
            displayCurrentCard();
        }, 200);
    }
}

function prevWord() {
    if (currentCardIndex > 0) {
        const wordCard = document.getElementById('wordCard');
        wordCard.classList.remove('fade-in');
        wordCard.classList.add('fade-out');

        setTimeout(() => {
            currentCardIndex--;
            displayCurrentCard();
        }, 200);
    }
}

// --- Load statistics ---
async function loadStatistics() {
    if (!currentUserId) return;
    const statsContent = document.getElementById('statsContent');
    if (!statsContent) return;

    const url = `${API_BASE_URL}/api/stats?user_id=${encodeURIComponent(currentUserId)}&_=${Date.now()}`;
    try {
        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' },
            credentials: isSameOrigin(API_BASE_URL) ? 'include' : 'omit'
        });

        if (!response.ok) {
            const txt = await response.text().catch(()=>'');
            throw new Error(`Ошибка HTTP: ${response.status} ${txt}`);
        }

        const stats = await response.json();

        // Массив частей речи с их ключами и метками
        const partsOfSpeech = [
            { label: 'Существительных', key: 'nouns', color: '#2e7d32' },
            { label: 'Глаголов', key: 'verbs', color: '#2e7d32' },
            { label: 'Прилагательных', key: 'adjectives', color: '#2e7d32' },
            { label: 'Наречий', key: 'adverbs', color: '#2e7d32' },
            { label: 'Другое', key: 'others', color: '#2e7d32' }
        ];

        // Фильтруем только те части речи, что больше 0
        const nonZeroParts = partsOfSpeech.filter(p => stats[p.key] && stats[p.key] > 0);

        let html = '';

        if ((stats.total ?? 0) === 0 || nonZeroParts.length === 0) {
            // Если всего слов нет или нет частей речи > 0
            const statsContent = document.getElementById('statsContent');

            statsContent.innerHTML = ''; // очищаем содержимое

            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'empty-message';
            emptyMessage.innerHTML = `
                <div class="empty-icon">
                    <i class="fas fa-chart-bar"></i>
                </div>
                <h3>Нет добавленных слов для отображения статистики</h3>
                <p>Добавьте новые слова, чтобы начать видеть статистику по частям речи.</p>
            `;

    statsContent.appendChild(emptyMessage);
    statsContent.style.display = 'block';
        } else {
            // Генерируем карточки частей речи > 0
            const partsHtml = nonZeroParts.map(p => `
                <div style="background:#e8f5e9; padding:15px; border-radius:10px; min-width:120px;">
                    <div style="font-size:2rem; color:${p.color}; font-weight:bold;">
                        ${escapeHTML(String(stats[p.key]))}
                    </div>
                    <div>${p.label}</div>
                </div>
            `).join('');

            // Всего слов всегда показываем, если > 0
            const totalHtml = `
                <div style="background:#e8f5e9; padding:15px; border-radius:10px; min-width:120px;">
                    <div style="font-size:2rem; color:#2e7d32; font-weight:bold;">
                        ${escapeHTML(String(stats.total ?? 0))}
                    </div>
                    <div>Всего слов</div>
                </div>
            `;

            html = `
                    <div class="no-stats">
                        <div class="icon">📊</div>
                        <div class="message">Нет добавленных слов для отображения статистики</div>
                    </div>
                `;

        }

        statsContent.innerHTML = html;

    } catch (err) {
        console.error('loadStatistics error:', err);
        statsContent.innerHTML = '<div style="color:red;">Ошибка загрузки статистики</div>';
    }
}

// --- Add/Edit word ---
async function addWord() {
    const wordInput = document.getElementById('newWord');
    const partOfSpeechSelect = document.getElementById('partOfSpeech');
    const contextInput = document.getElementById('context');
    const isPublicToggle = document.getElementById('wordPublic');
    const addWordBtn = document.getElementById('addWordBtn');

    if (!wordInput || !partOfSpeechSelect) return;

    const word = wordInput.value.trim();
    const partOfSpeech = partOfSpeechSelect.value;
    const context = contextInput ? contextInput.value.trim() : '';
    const isPublic = isPublicToggle ? isPublicToggle.checked : false;

    // Получаем все переводы из полей ввода
    const translationInputs = document.querySelectorAll('.translation-input');
    const translations = [];

    translationInputs.forEach(input => {
        const value = input.value.trim();
        if (value) {
            translations.push(value);
        }
    });

    if (!currentUserId) {
        showNotification('Ошибка: Не указан user_id', 'error');
        return;
    }

    if (!word) {
        showNotification('Пожалуйста, введите слово', 'error');
        return;
    }

    if (translations.length === 0) {
        showNotification('Пожалуйста, введите хотя бы один перевод', 'error');
        return;
    }

    if (!partOfSpeech){
        showNotification('Пожалуйста, выберете часть речи', 'error');
        return;
    }

    // Создаем словари в формате, ожидаемом бэкендом
    const translationDict = {};

    // Получаем информацию о частях речи для каждого перевода
    const translationsContainer = document.getElementById('translationsContainer');
    const translationWrappers = translationsContainer.querySelectorAll('.translation-input-wrapper');

    for (let i = 0; i < translations.length; i++) {
        const translation = translations[i];

        // Пропускаем пустые переводы
        if (!translation || translation.trim() === '') continue;

        let partOfSpeechValue = partOfSpeech; // значение по умолчанию

        // Ищем часть речи в соответствующем wrapper (если он есть)
        if (i < translationWrappers.length) {
            const wrapper = translationWrappers[i];
            const badge = wrapper.querySelector('.part-of-speech-badge');

            if (badge) {
                const badgePartOfSpeech = badge.getAttribute('data-part-of-speech');
                if (badgePartOfSpeech) {
                    partOfSpeechValue = badgePartOfSpeech;
                }
            }
        }

        // Добавляем в словарь: перевод -> часть речи
        translationDict[translation] = partOfSpeechValue;
    }

    const payload = {
        user_id: currentUserId,
        word: word.toLowerCase(),
        translations: translationDict,
        is_public: isPublic,
        context: context
    };

    let url = `${API_BASE_URL}/api/words`;
    let method = 'POST';

    // Если в режиме редактирования
    if (isEditingMode && editingWordId) {
        method = 'PUT';
        payload.word_id = editingWordId;
    }

    try {
        if (loadingOverlay) loadingOverlay.style.display = 'flex';
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(payload),
            credentials: isSameOrigin(API_BASE_URL) ? 'include' : 'omit'
        });

        const text = await response.text().catch(()=>null);
        // Проверка статуса 403
        if (response.status === 403) {
            let msg = `Активируйте подписку`;
            try {
                const json = text ? JSON.parse(text) : null;
                if (json && (json.detail || json.message)) {
                    msg = json.detail || json.message;
                }
            } catch (e) {
                // Игнорируем ошибки парсинга, используем стандартное сообщение
            }
            throw new Error(msg);
        }

        // Проверка статуса 409
        if (response.status == 409) {
            let msg = `Слово уже существует`;
            showNotification(`Слово "${escapeHTML(word)}" уже добавлено!`, 'error');
            return;
        }

        // Проверка всех остальных ошибок
        if (!response.ok) {
            console.error('addWord bad response', response.status, text);
            let msg = `Ошибка сервера (${response.status})`;
            try {
                const json = text ? JSON.parse(text) : null;
                if (json && (json.error || json.message || json.detail)) {
                    msg = json.error || json.message || json.detail;
                }
            } catch (e) {
                if (text) msg = text;
            }
            throw new Error(msg);
        }

        // success
        resetAddWordForm();

        // Останавливаем запись голоса если активна
        const voiceRecordBtn = document.getElementById('voiceRecordBtn');
        if (voiceRecordBtn && voiceRecordBtn.classList.contains('active')) {
            voiceRecordBtn.classList.remove('active');
            const icon = voiceRecordBtn.querySelector('i');
            icon.classList.remove('fa-stop');
            icon.classList.add('fa-microphone');
            if (recognition) {
                recognition.stop();
            }
        }

        showNotification(isEditingMode ? `Слово "${escapeHTML(word)}" обновлено!` : `Слово "${escapeHTML(word)}" добавлено!`, 'success');

        // Выходим из режима редактирования
        exitEditMode();

        const activePage = document.querySelector('.page.active');
        if (activePage && activePage.id === 'all-words') await loadWords();
        if (document.getElementById('statistics')?.classList.contains('active')) await loadStatistics();

    } catch (err) {
        console.error('addWord error:', err);
        showNotification(`Ошибка: ${err.message || err}`, 'error');
    } finally {
        if (loadingOverlay) loadingOverlay.style.display = 'none';
    }
}
// --- Edit word functionality ---
function enterEditMode(wordId) {
    console.log('Entering edit mode for wordId:', wordId, 'currentWords:', currentWords);

    const word = currentWords.find(w => {
        // Пробуем разные поля для поиска слова
        if (w.id === wordId || w.word_id === wordId) return true;
        // Также пробуем сравнить как строки на случай, если типы разные
        if (String(w.id) === String(wordId) || String(w.word_id) === String(wordId)) return true;
        return false;
    });

    if (!word) {
        console.error('Word not found for editing:', wordId, currentWords);
        showNotification('Слово не найдено для редактирования', 'error');
        return;
    }

    console.debug('Found word for editing:', word);

    isEditingMode = true;
    editingWordId = wordId;

    // Заполняем форму
    document.getElementById('newWord').value = word.word || '';

    // Устанавливаем часть речи (берем из первого перевода)
    let partOfSpeech = '';
    if (word.originalTranslations && word.originalTranslations['1']) {
        partOfSpeech = word.originalTranslations['1'].part_of_speech;
    } else if (word.part_of_speech) {
        partOfSpeech = word.part_of_speech;
    }

    document.getElementById('partOfSpeech').value = partOfSpeech || '';
    document.getElementById('context').value = word.context || '';
    document.getElementById('wordPublic').checked = word.is_public || false;

    // Обновляем отображение части речи
    const partOfSpeechSelect = document.getElementById('partOfSpeech');
    const partOfSpeechDisplay = document.getElementById('partOfSpeechDisplay');
    if (partOfSpeechDisplay && partOfSpeechSelect) {
        const selectedOption = partOfSpeechSelect.options[partOfSpeechSelect.selectedIndex];
        if (selectedOption) {
            partOfSpeechDisplay.querySelector('span').textContent = selectedOption.text;
        }
    }

    // Заполняем переводы (используем translationsArray)
    const translations = word.translationsArray || [];
    populateTranslationFields(translations, partOfSpeech);

    // Меняем текст кнопки
    const addWordBtn = document.getElementById('addWordBtn');
    if (addWordBtn) {
        addWordBtn.innerHTML = '<i class="fas fa-save"></i> Сохранить изменения';
    }

    // Переключаемся на вкладку добавления слова
    document.querySelectorAll('.bookmark').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

    document.querySelector('.bookmark[data-page="add-word"]').classList.add('active');
    document.getElementById('add-word').classList.add('active');

    showNotification('Режим редактирования слова', 'success');
}

function exitEditMode() {
    isEditingMode = false;
    editingWordId = null;

    // Возвращаем текст кнопки
    const addWordBtn = document.getElementById('addWordBtn');
    if (addWordBtn) {
        addWordBtn.innerHTML = '<i class="fas fa-plus"></i> Добавить в словарь';
    }

    // Очищаем форму
    resetAddWordForm();
}

function resetAddWordForm() {
    document.getElementById('newWord').value = '';
    document.getElementById('context').value = '';
    document.getElementById('wordPublic').checked = false;

    // Сбрасываем часть речи к первой опции
    const partOfSpeechSelect = document.getElementById('partOfSpeech');
    const partOfSpeechDisplay = document.getElementById('partOfSpeechDisplay');
    if (partOfSpeechSelect) {
        partOfSpeechSelect.value = '';
        if (partOfSpeechDisplay) {
            partOfSpeechDisplay.querySelector('span').textContent = 'Выбрать часть речи';
        }
    }

    clearTranslationFields();
}

// --- Find translation ---
async function findTranslation() {
    const searchWordInput = document.getElementById('searchWord');
    if (!searchWordInput) return;

    let word = searchWordInput.value.trim();
    if (!word) { showNotification('Введите слово для поиска', 'error'); return; }

    // Приводим слово к нижнему регистру перед отправкой
    word = word.toLowerCase();

    if (!currentUserId) { showNotification('Ошибка: Не указан user_id', 'error'); return; }

    const url = `${API_BASE_URL}/api/words/search?user_id=${encodeURIComponent(currentUserId)}&word=${encodeURIComponent(word)}`;
    try {
        if (loadingOverlay) loadingOverlay.style.display = 'flex';
        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' },
            credentials: isSameOrigin(API_BASE_URL) ? 'include' : 'omit'
        });

        const text = await response.text().catch(() => null);
        if (!response.ok) {
            console.error('findTranslation bad response', response.status, text);
            throw new Error(`Ошибка HTTP: ${response.status}`);
        }

        const result = text ? JSON.parse(text) : null;
        console.log('Результат поиска:', result);
        const searchResult = document.getElementById('searchResult');
        if (!searchResult) return;

        // Обновляем заголовок и скрываем поле ввода
        const searchHeaderDefault = document.querySelector('.search-header-default');
        const searchHeaderResult = document.querySelector('.search-header-result');
        const searchInputRow = document.getElementById('searchInputRow');
        const searchedWordTitle = document.getElementById('searchedWordTitle');

        if (searchHeaderDefault) searchHeaderDefault.style.display = 'none';
        if (searchHeaderResult) searchHeaderResult.style.display = 'flex';
        if (searchInputRow) searchInputRow.style.display = 'none';
        if (searchedWordTitle) searchedWordTitle.textContent = word;

        // Очищаем предыдущие результаты
        searchResult.innerHTML = '';

        if (result) {
            // 1) Слово пользователя - преобразуем структуру если нужно
            if (result.user_word) {
                const transformedWord = transformWordStructure(result.user_word);
                const userWordCard = createUserWordCard(transformedWord);
                searchResult.appendChild(userWordCard);
            }

            // 2) Слова других пользователей
            if (result.all_users_words && typeof result.all_users_words === 'object') {
                // Преобразуем все слова других пользователей
                const otherWords = [];
                Object.keys(result.all_users_words).forEach(userId => {
                    const userWords = result.all_users_words[userId];
                    if (Array.isArray(userWords)) {
                        userWords.forEach(word => {
                            if (word) otherWords.push(transformWordStructure(word));
                        });
                    }
                });

                if (otherWords.length > 0) {
                    const otherWordsContainer = createOtherUsersWords(otherWords);
                    if (otherWordsContainer.children.length > 0) {
                        searchResult.appendChild(otherWordsContainer);
                    }
                }
            }

            // 3) Если ничего нет - сообщение
            const hasContent = result.user_word ||
                             (result.all_users_words && Object.keys(result.all_users_words).length > 0);

            if (!hasContent) {
                const emptyMessage = document.createElement('div');
                emptyMessage.className = 'empty-message';
                emptyMessage.innerHTML = `
                    <div class="empty-icon">
                        <i class="fas fa-bullhorn"></i>
                    </div>
                    <h3>Будьте первыми, кто сделает запись этого слова публичным!</h3>
                `;
                searchResult.appendChild(emptyMessage);
            }

            searchResult.style.display = 'block';
        } else {
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'empty-message';
            emptyMessage.innerHTML = `
                <div class="empty-icon">
                    <i class="fas fa-bullhorn"></i>
                </div>
                <h3>Будьте первыми, кто сделает запись этого слова публичным!</h3>
            `;
            searchResult.appendChild(emptyMessage);
            searchResult.style.display = 'block';
        }

    } catch (err) {
        console.error('findTranslation error:', err);
        showNotification('Ошибка при поиске слова', 'error');
    } finally {
        if (loadingOverlay) loadingOverlay.style.display = 'none';
    }
}

// Вспомогательные функции для создания элементов
function createUserWordCard(userWord) {
    const card = document.createElement('div');
    card.className = 'user-word-card';

    // Форматируем дату
    const date = new Date(userWord.created_at);
    const formattedDate = date.toLocaleDateString('ru-RU');

    // Используем translationsArray для отображения
    const translations = userWord.translationsArray || [];

    card.innerHTML = `
        <div class="user-word-header">
            <span class="user-word-text">${escapeHTML(userWord.word)}</span>
            <span class="user-word-pos">${getPartOfSpeechName(userWord.part_of_speech || '')}</span>
        </div>
        <div class="user-word-translations">
            <ol>
                ${translations.map(trans => `<li>${escapeHTML(trans)}</li>`).join('')}
            </ol>
        </div>
        <div class="user-word-date">${formattedDate}</div>
    `;

    return card;
}

function createOtherUsersWords(wordsArray) {
    const container = document.createElement('div');
    container.className = 'other-users-words';

    console.log('🔧 Обрабатываем слова других пользователей:', wordsArray);

    if (!wordsArray || wordsArray.length === 0) {
        console.log('❌ Нет слов для отображения');
        return container;
    }

    const title = document.createElement('h3');
    title.className = 'other-words-title';
    title.textContent = 'Переводы других пользователей';
    container.appendChild(title);

    // Создаем элементы для каждого слова (максимум 3)
    wordsArray.slice(0, 3).forEach((wordData, index) => {
        console.log(`🔤 Обрабатываем слово ${index + 1}:`, wordData);

        // Проверка валидности слова
        if (wordData && wordData.word && wordData.word.trim() !== '') {
            const wordElement = createOtherUserWord(wordData);
            container.appendChild(wordElement);
        } else {
            console.warn('❌ Пропущено невалидное слово:', wordData);
        }
    });

    console.log('✅ Итоговый контейнер:', container.children.length, 'элементов');
    return container;
}

function createOtherUserWord(wordData) {
    const wordElement = document.createElement('div');
    wordElement.className = 'other-user-word';
    wordElement.setAttribute('data-word-id', wordData.id || wordData.word_id || '');

    console.log('🎨 Создаем элемент для слова:', wordData);

    // Форматируем дату
    let formattedDate = '';
    if (wordData.created_at) {
        const date = new Date(wordData.created_at);
        if (!isNaN(date.getTime())) {
            formattedDate = date.toLocaleDateString('ru-RU');
        }
    }

    // Статистика с значениями по умолчанию
    const likes = wordData.likes || '';
    const dislikes = wordData.dislikes || '';
    const comments = wordData.comments || '';

    // Получаем первый перевод из translationsArray
    const translations = wordData.translationsArray || [];
    const translationText = translations.length > 0 ? translations[0] : '';

    // Получаем nickname или используем значение по умолчанию
    const nickname = wordData.nickname || 'anonymous';

    wordElement.innerHTML = `
        <div class="other-word-first-line">
            <div class="other-word-text-container">
                <span class="other-word-text">${escapeHTML(wordData.word)}</span>
                <span class="other-word-separator"> — </span>
                <span class="other-word-translation">${escapeHTML(translationText)}</span>
            </div>
        </div>
        <div class="other-word-second-line">
            <div class="other-word-stats">
                <span class="stat-item"><i class="fas fa-thumbs-up"></i> ${likes}</span>
                <span class="stat-item"><i class="fas fa-thumbs-down"></i> ${dislikes}</span>
                <span class="stat-item"><i class="fas fa-comments"></i> ${comments}</span>
            </div>
            <div class="other-word-meta">
                <span class="other-word-username">@${escapeHTML(nickname)}</span>
                ${formattedDate ? `<span class="other-word-date">${formattedDate}</span>` : ''}
            </div>
        </div>
    `;

    // Обработчик клика для перехода на детальную страницу
    wordElement.addEventListener('click', function() {
        console.log('🔗 Переход к слову:', wordData);
        // window.location.href = `/word-details.html?word_id=${wordData.id}`;
    });

    return wordElement;
}

// --- Delete word ---
async function deleteWord(wordId) {

    if (!wordId) { showNotification('Ошибка: не указан ID слова', 'error'); return; }
    if (!confirm('Вы уверены, что хотите удалить это слово?')) return;
    if (!currentUserId) { showNotification('Ошибка: Не указан user_id', 'error'); return; }

    const url = `${API_BASE_URL}/api/words?user_id=${currentUserId}&word_id=${wordId}`;

    console.log('Delete URL:', url);

    try {
        if (loadingOverlay) loadingOverlay.style.display = 'flex';
        const response = await fetch(url, {
            method: 'DELETE',
            headers: { 'Accept': 'application/json' },
            credentials: isSameOrigin(API_BASE_URL) ? 'include' : 'omit'
        });

        const text = await response.text().catch(() => null);
        if (!response.ok) {
            console.error('deleteWord bad response', response.status, text);
            throw new Error(`Ошибка удаления (${response.status})`);
        }

        showNotification('Слово успешно удалено', 'success');

        // Перезагружаем слова и обновляем интерфейс
        await loadWords();

        const activePage = document.querySelector('.page.active');
        if (activePage && activePage.id === 'all-words') {
            // Если остались слова, сбрасываем индекс на 0
            if (currentWords.length > 0) {
                currentCardIndex = 0;
                displayCurrentCard();
            }
        }

        if (document.getElementById('statistics')?.classList.contains('active')) {
            await loadStatistics();
        }
    } catch (err) {
        console.error('deleteWord error:', err);
        showNotification('Ошибка при удалении слова', 'error');
    } finally {
        if (loadingOverlay) loadingOverlay.style.display = 'none';
    }
}

// --- Navigation bookmarks with smooth carousel animation ---
function setupBookmarks() {
    const bookmarks = document.querySelectorAll('.bookmark');
    const sidebar = document.querySelector('.bookmarks-sidebar');

    bookmarks.forEach(bookmark => {
        bookmark.addEventListener('click', function() {
            // Если уже активна - ничего не делаем
            if (this.classList.contains('active')) return;

            const clickedBookmark = this;
            const allBookmarks = Array.from(sidebar.children);
            const clickedIndex = allBookmarks.indexOf(clickedBookmark);

            // Убираем активность у всех
            bookmarks.forEach(b => b.classList.remove('active'));
            // Добавляем активность текущей
            this.classList.add('active');

            // Переключаем страницы
            document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));

            const pageId = this.getAttribute('data-page');
            const pageElement = document.getElementById(pageId);
            if (pageElement) pageElement.classList.add('active');

            if (pageId === 'all-words') loadWords();
            if (pageId === 'statistics') loadStatistics();

            // Плавная анимация карусели
            animateBookmarkCarousel(clickedBookmark, clickedIndex, allBookmarks, sidebar);
        });
    });
}

function animateBookmarkCarousel(clickedBookmark, clickedIndex, allBookmarks, sidebar) {
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        // Мобильная анимация - горизонтальная
        animateMobileCarousel(clickedBookmark, clickedIndex, allBookmarks, sidebar);
    } else {
        // Десктопная анимация - вертикальная
        animateDesktopCarousel(clickedBookmark, clickedIndex, allBookmarks, sidebar);
    }
}

function animateDesktopCarousel(clickedBookmark, clickedIndex, allBookmarks, sidebar) {
    const bookmarksAbove = allBookmarks.slice(0, clickedIndex);
    const bookmarksBelow = allBookmarks.slice(clickedIndex + 1);

    // Новый порядок: кликнутая закладка + все ниже + все выше
    const newOrder = [clickedBookmark, ...bookmarksBelow, ...bookmarksAbove];

    // Помечаем все закладки как анимируемые
    allBookmarks.forEach(bookmark => {
        bookmark.classList.add('animating');
    });

    // Анимация для закладок выше - уходят вверх
    bookmarksAbove.forEach((bookmark, index) => {
        bookmark.style.transition = `transform 0.5s cubic-bezier(0.4, 0, 0.2, 1) ${index * 0.1}s, opacity 0.5s ease ${index * 0.1}s`;
        bookmark.classList.add('desktop-slide-up');
    });

    // Анимация для закладок ниже - сдвигаются вверх
    bookmarksBelow.forEach((bookmark, index) => {
        const delay = (bookmarksAbove.length + index) * 0.1;
        bookmark.style.transition = `transform 0.5s cubic-bezier(0.4, 0, 0.2, 1) ${delay}s`;
        bookmark.style.transform = `translateY(-${clickedBookmark.offsetHeight}px)`;
    });

    // Анимация для кликнутой закладка - поднимается наверх
    clickedBookmark.style.transition = `transform 0.5s cubic-bezier(0.4, 0, 0.2, 1) ${bookmarksAbove.length * 0.1}s`;
    clickedBookmark.style.transform = `translateY(-${clickedIndex * clickedBookmark.offsetHeight}px)`;

    // После завершения анимации перестраиваем DOM
    setTimeout(() => {
        sidebar.innerHTML = '';
        newOrder.forEach(bookmark => {
            // Сбрасываем стили
            bookmark.style.transition = '';
            bookmark.style.transform = '';
            bookmark.style.opacity = '';
            bookmark.classList.remove('animating', 'desktop-slide-up', 'desktop-slide-down');
            sidebar.appendChild(bookmark);
        });
    }, 500 + Math.max(bookmarksAbove.length, bookmarksBelow.length) * 100);
}

function animateMobileCarousel(clickedBookmark, clickedIndex, allBookmarks, sidebar) {
    const bookmarksLeft = allBookmarks.slice(0, clickedIndex);
    const bookmarksRight = allBookmarks.slice(clickedIndex + 1);

    // Новый порядок: кликнутая закладка + все справа + все слева
    const newOrder = [clickedBookmark, ...bookmarksRight, ...bookmarksLeft];

    // Помечаем все закладки как анимируемые
    allBookmarks.forEach(bookmark => {
        bookmark.classList.add('animating');
    });

    // Анимация для закладок слева - уходят влево
    bookmarksLeft.forEach((bookmark, index) => {
        bookmark.style.transition = `transform 0.5s cubic-bezier(0.4, 0, 0.2, 1) ${index * 0.1}s, opacity 0.5s ease ${index * 0.1}s`;
        bookmark.classList.add('mobile-slide-left');
    });

    // Анимация для закладок справа - сдвигаются влево
    bookmarksRight.forEach((bookmark, index) => {
        const delay = (bookmarksLeft.length + index) * 0.1;
        bookmark.style.transition = `transform 0.5s cubic-bezier(0.4, 0, 0.2, 1) ${delay}s`;
        bookmark.style.transform = `translateX(-${clickedBookmark.offsetWidth * clickedIndex}px)`;
    });

    // Анимация для кликнутой закладки - сдвигается влево
    clickedBookmark.style.transition = `transform 0.5s cubic-bezier(0.4, 0, 0.2, 1) ${bookmarksLeft.length * 0.1}s`;
    clickedBookmark.style.transform = `translateX(-${clickedBookmark.offsetWidth * clickedIndex}px)`;

    // После завершения анимации перестраиваем DOM
    setTimeout(() => {
        sidebar.innerHTML = '';
        newOrder.forEach(bookmark => {
            // Сбрасываем стили
            bookmark.style.transition = '';
            bookmark.style.transform = '';
            bookmark.style.opacity = '';
            bookmark.classList.remove('animating', 'mobile-slide-left', 'mobile-slide-right');
            sidebar.appendChild(bookmark);
        });

        // Прокручиваем к активной закладке
        clickedBookmark.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 500 + Math.max(bookmarksLeft.length, bookmarksRight.length) * 100);
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
    userIdElement = document.getElementById('userId');
    wordsListElement = document.getElementById('wordsList');
    notificationElement = document.getElementById('notification');
    loadingOverlay = document.getElementById('loadingOverlay');
    wordsLoading = document.getElementById('wordsLoading');

    // 🔄 УЛУЧШЕННАЯ ИНИЦИАЛИЗАЦИЯ С ИЗВЛЕЧЕНИЕМ ИЗ URL
    function initializeFromURL() {
        console.log('🔄 Извлечение данных из URL hash...');

        try {
            // Получаем параметры из hash
            const hashParams = new URLSearchParams(window.location.hash.substring(1));
            const tgWebAppData = hashParams.get('tgWebAppData');

            if (tgWebAppData) {
                console.log('✅ tgWebAppData найден в URL hash');

                // Парсим tgWebAppData
                const dataParams = new URLSearchParams(tgWebAppData);
                const userParam = dataParams.get('user');

                if (userParam) {
                    // Декодируем и парсим JSON с пользователем
                    const decodedUser = decodeURIComponent(userParam);
                    const userData = JSON.parse(decodedUser);

                    console.log('👤 Данные пользователя из URL hash:', userData);

                    if (userData && userData.id) {
                        const userId = String(userData.id);
                        console.log('✅ USER ID извлечен из URL hash:', userId);
                        return userId;
                    }
                }
            }
        } catch (error) {
            console.error('❌ Ошибка при извлечении данных из URL hash:', error);
        }

        console.log('❌ USER ID не найден в URL hash');
        return null;
    }

    // 🔄 ФУНКЦИЯ ДЛЯ ЗАГРУЗКИ TELEGRAM WEBAPP С FALLBACK
    function loadTelegramWebApp() {
        return new Promise((resolve) => {
            // Если Telegram уже загружен, используем его
            if (window.Telegram?.WebApp) {
                console.log('✅ Telegram WebApp уже загружен');
                const tg = window.Telegram.WebApp;
                tg.ready();
                tg.expand();

                if (tg.initDataUnsafe?.user?.id) {
                    resolve(String(tg.initDataUnsafe.user.id));
                    return;
                }
            }

            // Если не загружен, пробуем загрузить скрипт
            console.log('🔄 Попытка загрузки Telegram WebApp скрипта...');
            const script = document.createElement('script');
            script.src = 'https://telegram.org/js/telegram-web-app.js';
            script.onload = () => {
                console.log('✅ Telegram WebApp скрипт загружен');
                if (window.Telegram?.WebApp) {
                    const tg = window.Telegram.WebApp;
                    tg.ready();
                    tg.expand();

                    if (tg.initDataUnsafe?.user?.id) {
                        resolve(String(tg.initDataUnsafe.user.id));
                    } else {
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            };
            script.onerror = () => {
                console.error('❌ Ошибка загрузки Telegram WebApp скрипта');
                resolve(null);
            };
            document.head.appendChild(script);

            // Таймаут на случай, если скрипт не загрузится
            setTimeout(() => {
                resolve(null);
            }, 2000);
        });
    }

// 🔄 ФУНКЦИЯ ОБНОВЛЕНИЯ URL
function updateUrlWithUserId(userId) {
    try {
        const url = new URL(window.location);
        url.searchParams.set('user_id', userId);
        window.history.replaceState({}, '', url);
        console.log('🔗 URL обновлен:', url.toString());
    } catch (e) {
        console.warn('Не удалось обновить URL:', e);
    }
}

// 🔄 ФУНКЦИЯ ДЛЯ ИЗВЛЕЧЕНИЯ USER_ID ИЗ URL (добавьте эту новую функцию)
function getUserIdFromUrl() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const userId = urlParams.get('user_id');
        if (userId) {
            console.log('✅ USER ID найден в URL параметрах:', userId);
            return userId;
        }
    } catch (error) {
        console.error('❌ Ошибка при извлечении user_id из URL:', error);
    }
    return null;
}

// ФУНКЦИЯ ИНИЦИАЛИЗАЦИИ
async function initializeApp() {
    let userId = null;

    // 0. ПЕРВЫЙ ПРИОРИТЕТ: Пробуем извлечь из URL параметров (для отладки)
    userId = getUserIdFromUrl();

    // 1. Если не нашли в URL, пробуем загрузить Telegram WebApp
    if (!userId) {
        userId = await loadTelegramWebApp();
    }

    // 2. Если не получилось, извлекаем из URL hash (старый способ)
    if (!userId) {
        userId = initializeFromURL();
    }

    // 3. Устанавливаем user_id
    if (userId) {
        currentUserId = userId;
        console.log('🎉 USER ID установлен:', currentUserId);

        // Обновляем URL с user_id для отладки
        updateUrlWithUserId(currentUserId);

        // Загружаем данные
        loadWords();
        loadStatistics();
    } else {
        // 4. Если user_id не найден
        console.error('❌ Не удалось определить user_id');
        showNotification('Ошибка: Не удалось определить ID пользователя', 'error');
    }

    // Инициализируем остальные компоненты
    setupEventListeners();
    initializeCustomComponents();
    initializeVoiceRecognition();
}

    // 🔄 ФУНКЦИЯ ОБНОВЛЕНИЯ URL
    function updateUrlWithUserId(userId) {
        try {
            const url = new URL(window.location);
            url.searchParams.set('user_id', userId);
            window.history.replaceState({}, '', url);
            console.log('🔗 URL обновлен:', url.toString());
        } catch (e) {
            console.warn('Не удалось обновить URL:', e);
        }
    }

    // 🔄 ФУНКЦИЯ ДЛЯ НАСТРОЙКИ ОСТАЛЬНЫХ СЛУШАТЕЛЕЙ СОБЫТИЙ
    function setupEventListeners() {
        // Делегирование удаления
        if (wordsListElement) {
            wordsListElement.addEventListener('click', (event) => {
                const btn = event.target.closest('.delete-btn');
                if (!btn) return;
                const wordId = btn.getAttribute('data-id');
                deleteWord(wordId);
            });
        }


        setupBookmarks();

        // Обработчики для добавления слова в словарь
        document.getElementById('addWordBtn')?.addEventListener('click', addWord);

        // Слушаем ввод слова для обновления состояния кнопки плюсика
        document.getElementById('newWord')?.addEventListener('input', function() {
            updateTranslationAddButtons();
        });

        // Обработчики для навигации по карточкам
        document.getElementById('nextWordBtn')?.addEventListener('click', nextWord);
        document.getElementById('prevWordBtn')?.addEventListener('click', prevWord);

        // Обработчик для кнопки возврата в поиске
        document.getElementById('searchBtn')?.addEventListener('click', findTranslation);
        document.getElementById('refreshSearch')?.addEventListener('click', resetSearchView);

        initializeCardMenu();
    }

    function resetSearchView() {
        // Восстанавливаем исходное состояние поиска
        document.querySelector('.search-header-default').style.display = 'block';
        document.getElementById('searchInputRow').style.display = 'flex';
        document.querySelector('.search-header-result').style.display = 'none';

        // Очищаем результаты
        const searchResult = document.getElementById('searchResult');
        searchResult.innerHTML = '';
        searchResult.style.display = 'none';

        // Очищаем поле ввода
        document.getElementById('searchWord').value = '';
    }

    // 🔄 ИНИЦИАЛИЗАЦИЯ КАСТОМНЫХ КОМПОНЕНТОВ
    function initializeCustomComponents() {
        const partOfSpeechDisplay = document.getElementById('partOfSpeechDisplay');
        const partOfSpeechSelect = document.getElementById('partOfSpeech');
        const options = Array.from(partOfSpeechSelect.options);

        // Находим опцию с подсказкой (первая опция с пустым value)
        const hintOption = options.find(opt => opt.value === '');
        const speechOptions = options.filter(opt => opt.value !== ''); // Только реальные части речи

        let isHintMode = true;

        if (partOfSpeechDisplay) {
            // Устанавливаем начальную подсказку
            partOfSpeechDisplay.querySelector('span').textContent = hintOption.text;
            partOfSpeechSelect.value = hintOption.value;

            partOfSpeechDisplay.addEventListener('click', function() {
                let selectedOption;

                if (isHintMode) {
                    // Первый клик - переходим к первой реальной части речи
                    selectedOption = speechOptions[0];
                    isHintMode = false;
                } else {
                    // Последующие клики - циклически перебираем реальные части речи
                    const currentIndex = speechOptions.findIndex(opt => opt.value === partOfSpeechSelect.value);
                    const nextIndex = (currentIndex + 1) % speechOptions.length;
                    selectedOption = speechOptions[nextIndex];
                }

                partOfSpeechDisplay.querySelector('span').textContent = selectedOption.text;
                partOfSpeechSelect.value = selectedOption.value;

                this.classList.add('active');
                setTimeout(() => {
                    this.classList.remove('active');
                }, 300);

                // Обновляем кнопки добавления перевода
                updateTranslationAddButtons();
            });
        }

        // Инициализируем множественные переводы
        initializeMultipleTranslations();

        // Обработчик для кнопки приватности
        const wordPublic = document.getElementById('wordPublic');
        if (wordPublic) {
            wordPublic.addEventListener('change', function() {
                const privacyBtn = this.closest('.privacy-btn');
                if (this.checked) {
                    privacyBtn.title = 'Публичное слово (видят все)';
                    showNotification('Слово будет публичным', 'success');
                } else {
                    privacyBtn.title = 'Приватное слово (только для вас)';
                    showNotification('Слово будет приватным', 'success');
                }
                console.log('Word visibility:', this.checked ? 'public' : 'private');
            });
        }
    }

    // 🔄 ИНИЦИАЛИЗАЦИЯ ГОЛОСОВОГО ВВОДА
    function initializeVoiceRecognition() {
        const voiceRecordBtn = document.getElementById('voiceRecordBtn');
        if (!voiceRecordBtn) return;

        // Проверяем поддержку браузером
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            voiceRecordBtn.style.display = 'none';
            showNotification('Голосовой ввод не поддерживается вашим браузером', 'error');
            return;
        }

        // Создаем экземпляр распознавания речи
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();

        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US'; // Распознаем английскую речь

        voiceRecordBtn.addEventListener('click', toggleVoiceRecording);

        recognition.onstart = function() {
            isRecording = true;
            voiceRecordBtn.classList.add('active');
            voiceRecordBtn.innerHTML = '<i class="fas fa-stop"></i>';
            showNotification('Говорите сейчас...', 'success');
        };

        recognition.onresult = function(event) {
            const transcript = event.results[0][0].transcript;
            const wordInput = document.getElementById('newWord');
            if (wordInput) {
                wordInput.value = transcript;
                showNotification(`Распознано: "${transcript}"`, 'success');
                updateTranslationAddButtons();
            }
        };

        recognition.onerror = function(event) {
            console.error('Speech recognition error:', event.error);
            let errorMessage = 'Ошибка распознавания речи';
            if (event.error === 'not-allowed') {
                errorMessage = 'Разрешите доступ к микрофону';
            } else if (event.error === 'audio-capture') {
                errorMessage = 'Микрофон не найден';
            }
            showNotification(errorMessage, 'error');
        };

        // В функции initializeVoiceRecognition обновляем onend:
        recognition.onend = function() {
        // Дублируем остановку на случай, если запись закончилась сама
        if (isRecording) {
            isRecording = false;
            const voiceRecordBtn = document.getElementById('voiceRecordBtn');
            if (voiceRecordBtn) {
                voiceRecordBtn.classList.remove('active');
                voiceRecordBtn.innerHTML = '<i class="fas fa-microphone"></i>';
            }
        }
    };
    }

    // 🔄 ПЕРЕКЛЮЧЕНИЕ РЕЖИМА ЗАПИСИ ГОЛОСА
    function toggleVoiceRecording() {
        if (!recognition) return;
        
        if (isRecording) {
            isRecording = false
            const voiceRecordBtn = document.getElementById('voiceRecordBtn');
            if (voiceRecordBtn) {
                voiceRecordBtn.classList.remove('active');
                voiceRecordBtn.innerHTML = '<i class="fas fa-microphone"></i>';
            }
            recognition.stop();
        } else {
            try {
                recognition.start();
            } catch (error) {
                console.error('Error starting speech recognition:', error);
                showNotification('Ошибка запуска записи', 'error');
            }
        }
    }

    // Запускаем инициализацию
    initializeApp();
});