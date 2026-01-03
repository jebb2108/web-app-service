const API_BASE_URL = `${window.location.origin}/api/user` || 'https://chat.lllang.site/api/user';
const API_WORKER_URL = `${window.location.origin}/api/worker` || 'https://chat.lllang.site/api/worker'

// Массив креативных сообщений о поиске
const searchMessages = [
    "Подбираем сладости к чаю...",
    "Практикуем произношение...",
    "Читаем газету по интересам...",
    "Готовим фондю для душевной беседы...",
    "Собираем букет из интересных тем...",
    "Настраиваем языковые вибрации...",
    "Завариваем ароматный кофе для беседы...",
    "Перебираем словарный запас...",
    "Ищем общие интересы...",
    "Настраиваем атмосферу для общения...",
    "Подготавливаем интересные вопросы...",
    "Создаем уютную языковую среду...",
    "Подбираем идеальную пару для диалога...",
    "Наполняем чашу вдохновения...",
    "Готовим сюрпризы для беседы..."
];

// Функции для извлечения user_id из Telegram WebApp
async function getUserId() {
    let userId = null;
    
    // 1. Пробуем получить из Telegram WebApp
    userId = await getUserIdFromTelegram();
    
    // 2. Если не получилось, извлекаем из URL
    if (!userId) {
        userId = await getUserIdFromUrl();
    }
    
    return userId;
}

async function getUserIdFromTelegram() {
    return new Promise((resolve) => {
        if (window.Telegram?.WebApp) {
            const tg = window.Telegram.WebApp;
            tg.ready();
            tg.expand();
            
            if (tg.initDataUnsafe?.user?.id) {
                resolve(String(tg.initDataUnsafe.user.id));
                return;
            }
        }
        
        const script = document.createElement('script');
        script.src = 'https://telegram.org/js/telegram-web-app.js';
        script.onload = () => {
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
            resolve(null);
        };
        document.head.appendChild(script);
        
        setTimeout(() => {
            resolve(null);
        }, 10000);
    });
}

async function getUserIdFromUrl() {
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

// Проверка существования пользователя в БД
async function checkUserExists(userId) {
    try {
        const response = await fetch(`${API_BASE_URL}/check_profile?user_id=${encodeURIComponent(userId)}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        if (response.ok) {
            const result = await response.json();
            console.log(`Profile exists: ${result.exists}`);
            return result.exists;
        }
        return false;
    } catch (error) {
        console.error('Ошибка проверки пользователя:', error);
        return false;
    }
}

// Логика комнаты ожидания
let roomInitialized = false;
let userInQueue = false;
let currentQueueSize = 0;
let isLoading = false;
let searchMessageInterval = null;
let currentMessageIndex = 0;
let statusCheckInterval = null;
let matchFound = false;
let searchMessagesRunning = false;
let currentShuffledMessages = [];

const roomElements = {
    roomImage: document.getElementById('room-image'),
    userStatus: document.getElementById('user-status'),
    searchMessage: document.getElementById('search-message'),
    error: document.getElementById('room-error')
};

// Функция для смены сообщений поиска
function startSearchMessages() {
    if (searchMessageInterval) {
        clearInterval(searchMessageInterval);
    }

    // Перемешиваем сообщения каждый раз при входе в очередь
    currentShuffledMessages = [...searchMessages].sort(() => Math.random() - 0.5);
    currentMessageIndex = 0;

    roomElements.searchMessage.textContent = currentShuffledMessages[currentMessageIndex];
    roomElements.searchMessage.style.opacity = '1';

    searchMessageInterval = setInterval(() => {
        currentMessageIndex = (currentMessageIndex + 1) % currentShuffledMessages.length;
        roomElements.searchMessage.style.opacity = '0';

        setTimeout(() => {
            roomElements.searchMessage.textContent = currentShuffledMessages[currentMessageIndex];
            roomElements.searchMessage.style.opacity = '1';
        }, 500);
    }, 3000);
}

function stopSearchMessages() {
    if (searchMessageInterval) {
        clearInterval(searchMessageInterval);
        searchMessageInterval = null;
    }
    roomElements.searchMessage.style.opacity = '0';
    setTimeout(() => {
        roomElements.searchMessage.textContent = '';
    }, 500);
}

async function initRoom() {
    if (roomInitialized) return;

    // Обновляем статус пользователя и картинку комнаты
    await updateRoomImageOnInit();
    await checkUserStatus();

    // Запускаем периодическую проверку статуса пользователя
    startStatusChecking();

    // Периодически обновляем статус очереди
    setInterval(updateQueueData, 2000);

    roomInitialized = true;
}

// Функция для обновления картинки при инициализации
async function updateRoomImageOnInit() {
    try {
        // Получаем текущий размер очереди
        const response = await fetch(`${API_WORKER_URL}/queue/status`);
        if (response.ok) {
            const data = await response.json();
            currentQueueSize = data.queue_size;
            updateRoomImage(currentQueueSize);
        } else {
            console.warn('Не удалось получить статус очереди при инициализации');
            updateRoomImage(0); // Устанавливаем картинку по умолчанию
        }
    } catch (error) {
        console.error('Error updating room image on init:', error);
        updateRoomImage(0); // Устанавливаем картинку по умолчанию
    }

    updateUserStatus();
}

// Запуск периодической проверки статуса пользователя
function startStatusChecking() {
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
    }

    statusCheckInterval = setInterval(async () => {
        await checkUserStatus();
    }, 1000);
}

// Функция проверки статуса пользователя
async function checkUserStatus() {
    try {
        const userId = await getUserId();
        if (!userId) return;

        // Параллельно проверяем статус в очереди И наличие матча
        const [queueResponse, matchResponse] = await Promise.all([
            fetch(`${API_WORKER_URL}/queue/${userId}/status`),
            fetch(`${API_WORKER_URL}/check_match?user_id=${encodeURIComponent(userId)}`)
        ]);

        if (queueResponse.ok) {
            const queueData = await queueResponse.json();
            const wasInQueue = userInQueue;
            userInQueue = queueData.in_queue;

            updateUserStatus();

            if (!wasInQueue && userInQueue) {
                startSearchMessages();
            } else if (wasInQueue && !userInQueue && !matchFound) {
                stopSearchMessages();
            }
        }

        // ВСЕГДА проверяем матч, независимо от статуса очереди
        if (matchResponse.ok && !matchFound) {
            const matchData = await matchResponse.json();
            if (matchData.match_id) {
                matchFound = true;
                userInQueue = false;
                showMatchFound(matchData.match_id, matchData.room_id, userId);
            }
        }

    } catch (error) {
        console.error('Error checking user status:', error);
    }
}

// Функция сброса состояния поиска
function resetSearchState() {
    userInQueue = false;
    matchFound = false;
    updateRoomImage(currentQueueSize);
    roomElements.roomImage.onclick = toggleQueue;
    updateUserStatus();
    stopSearchMessages();
}

// Функция обновления статуса пользователя
function updateUserStatus() {
    if (matchFound) {
        roomElements.userStatus.textContent = 'Собеседник найден! Нажми чтобы начать общение';
        roomElements.roomImage.src = 'media/door.jpeg';
    } else if (userInQueue) {
        roomElements.userStatus.textContent = 'Ты в очереди';
        // Сообщения запускаются автоматически при изменении состояния
    } else {
        roomElements.userStatus.textContent = 'Нажми на комнату для поиска собеседника';
        updateRoomImage(currentQueueSize);
    }
}

// Функция переключения состояния очереди
async function toggleQueue() {
    if (isLoading || matchFound) return;

    setIsLoading(true);

    try {
        const userId = await getUserId();
        if (!userId) {
            throw new Error('Не удалось определить ID пользователя');
        }
        // Отправляем запрос в worker API
        const response = await fetch(`${API_WORKER_URL}/match/toggle`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                user_id: userId,
            })
        });

        if(response.status === 403){
            throw new Error(`Authorization error: status ${response.status}`);
        }

        if (response.ok) {
            await checkUserStatus()
        } else {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

    } catch (error) {
        showError('Ошибка: ' + error.message);
        console.error('Error toggling queue:', error);
    } finally {
        setIsLoading(false);
    }
}

// Функция проверки найденного матча
async function checkMatchFound() {
    try {
        const userId = await getUserId();
        if (!userId || matchFound) return;

        const response = await fetch(`${API_WORKER_URL}/check_match?user_id=${encodeURIComponent(userId)}`);
        if (response.ok) {
            const data = await response.json();
            if (data.match_id && data.room_id) {
                matchFound = true;
                userInQueue = false;
                showMatchFound(data.match_id, data.room_id, userId);
            }
        }
    } catch (error) {
        console.error('Error checking match found:', error);
    }
}

// Показать найденный матч
async function showMatchFound(matchId, roomId, userId) {
    roomElements.roomImage.src = 'media/door.jpeg';
    roomElements.userStatus.textContent = 'Собеседник найден! Нажми чтобы начать общение';

    // Заменяем обработчик на переход в чат
    roomElements.roomImage.onclick = async function() {
        try {
            const response = await fetch(`${API_BASE_URL}/create_token?user_id=${userId}&room_id=${roomId}`);
            if (response.ok) {
                const data = await response.json();
                window.location.href = `/enter/chat?user_id=${userId}&match_id=${matchId}&room_id=${roomId}&token=${data.token}`;
            } else {
                console.error("Failed to create token")
            }
        } catch (error) {
            console.error('Error creating token:', error);
        }
    };

    stopSearchMessages();
    showError('');
}

function setIsLoading(loading) {
    isLoading = loading;
    roomElements.roomImage.classList.toggle('loading', loading);
    if (loading) {
        roomElements.userStatus.textContent = 'Загрузка...';
    } else {
        updateUserStatus();
    }
}

function updateRoomImage(count) {
    if (matchFound) return;

    if (count === 0) {
        roomElements.roomImage.src = 'media/empty_room.jpeg';
    } else if (count < 5) {
        roomElements.roomImage.src = 'media/half_full_room.jpeg';
    } else {
        roomElements.roomImage.src = 'media/full_room.jpeg';
    }
}

function showError(message) {
    roomElements.error.textContent = message;
}

async function updateQueueData() {
    if (matchFound) return;

    try {
        const response = await fetch(`${API_WORKER_URL}/queue/status`);
        if (response.ok) {
            const data = await response.json();
            currentQueueSize = data.queue_size;
            updateRoomImage(data.queue_size);
        } else {
            console.warn('Не удалось получить статус очереди');
            resetSearchState();
        }
    } catch (error) {
        console.error('Error updating queue data:', error);
        resetSearchState();
    }
}

// Функция для автоматической расстановки дефисов в дате рождения
function formatBirthDateInput(input) {
    let value = input.value.replace(/\D/g, '');

    // Добавляем дефисы после 2 и 4 символов
    if (value.length > 4) {
        value = value.substring(0, 2) + '-' + value.substring(2, 4) + '-' + value.substring(4, 8);
    } else if (value.length > 2) {
        value = value.substring(0, 2) + '-' + value.substring(2, 4);
    }

    input.value = value;
}

document.addEventListener('DOMContentLoaded', function() {
    // Элементы страниц
    const loadingPage = document.getElementById('loadingPage');
    const welcomePage = document.getElementById('welcomePage');
    const registrationPage = document.getElementById('registrationPage');
    const roomPage = document.getElementById('roomPage');

    // Кнопки и формы
    const registrationForm = document.getElementById('registrationForm');
    const birthDateInput = document.getElementById('birth_date');
    const ageValidation = document.getElementById('ageValidation');
    const emailInput = document.getElementById('email');
    const emailCheckmark = document.querySelector('.email-checkmark');
    const birthDateCheckmark = document.querySelector('.birthdate-checkmark');
    const nicknameInput = document.getElementById('nickname');
    const nicknameCheckmark = document.querySelector('.nickname-checkmark');
    const nicknameHelp = document.querySelector('.nickname-help');

    // Новые элементы
    const romanticSection = document.getElementById('romanticSection');
    const romanticInterest = document.getElementById('romanticInterest');
    const datingSection = document.getElementById('datingSection');
    const shareLocationBtn = document.getElementById('shareLocation');
    const locationStatus = document.getElementById('locationStatus');
    const agreementText = document.getElementById('agreementText');

    // Элементы подсказки
    const nicknameTooltip = document.getElementById('nicknameTooltip');
    const closeTooltip = document.getElementById('closeTooltip');

    // Обработчик клика по картинке комнаты
    roomElements.roomImage.addEventListener('click', toggleQueue);

    // Инициализация приложения - показываем загрузочную страницу и проверяем пользователя
    async function initializeApp() {
        showPage(loadingPage);

        const userId = await getUserId();

        if (userId) {
            const userExists = await checkUserExists(userId);

            if (userExists) {
                // Показываем комнату ожидания и сразу инициализируем с правильной картинкой
                await initRoom();
                setTimeout(() => {
                    showPage(roomPage);
                }, 300);
            } else {
                // Показываем форму регистрации после небольшой задержки
                setTimeout(() => {
                    showPage(registrationPage);
                    validateNickname();
                }, 300);
            }
        } else {
            // Если user_id не определен, показываем welcomePage
            setTimeout(() => {
                showPage(welcomePage);
            }, 300);
        }
    }

    // Показать подсказку для никнейма
    nicknameHelp.addEventListener('click', function() {
        nicknameTooltip.classList.remove('hidden');
    });

    // Закрыть подсказку
    closeTooltip.addEventListener('click', function() {
        nicknameTooltip.classList.add('hidden');
    });

    // Закрыть подсказку при клике вне ее области
    nicknameTooltip.addEventListener('click', function(e) {
        if (e.target === nicknameTooltip) {
            nicknameTooltip.classList.add('hidden');
        }
    });

    // Валидация никнейма
    nicknameInput.addEventListener('input', function() {
        validateNickname();
    });

    function validateNickname() {
        const nickname = nicknameInput.value.trim();

        if (nickname.length < 6 || nickname.length > 15) {
            nicknameCheckmark.classList.remove('visible');
            nicknameHelp.classList.remove('hidden');
            return false;
        }

        const latinRegex = /^[a-zA-Z0-9_-]+$/;
        if (!latinRegex.test(nickname)) {
            nicknameCheckmark.classList.remove('visible');
            nicknameHelp.classList.remove('hidden');
            return false;
        }

        nicknameCheckmark.classList.add('visible');
        nicknameHelp.classList.add('hidden');
        return true;
    }

    // Автоматическая форматирование даты рождения с дефисами
    birthDateInput.addEventListener('input', function(e) {
        // Сохраняем позицию курсора
        const cursorPosition = this.selectionStart;
        const originalValue = this.value;

        // Форматируем значение
        formatBirthDateInput(this);

        // Восстанавливаем позицию курсора с учетом добавленных дефисов
        let newCursorPosition = cursorPosition;

        // Если мы добавили дефис, сдвигаем курсор
        if (this.value.length > originalValue.length) {
            newCursorPosition = this.value.length;
        }

        // Устанавливаем курсор
        this.setSelectionRange(newCursorPosition, newCursorPosition);

        // Запускаем валидацию
        validateBirthDate();
    });

    // Также обрабатываем событие keydown для лучшего UX
    birthDateInput.addEventListener('keydown', function(e) {
        // Разрешаем только цифры и управляющие клавиши
        if (!/[0-9]|Backspace|Delete|ArrowLeft|ArrowRight|Tab/.test(e.key)) {
            e.preventDefault();
            return false;
        }
    });

    function validateBirthDate() {
        const birthDateValue = birthDateInput.value.trim();

        const dateRegex = /^(\d{2})-(\d{2})-(\d{4})$/;
        if (!dateRegex.test(birthDateValue)) {
            ageValidation.textContent = 'Формат даты: ДД-ММ-ГГГГ';
            ageValidation.className = 'field-validation error';
            birthDateCheckmark.classList.remove('visible');
            romanticSection.classList.add('hidden');
            agreementText.classList.add('hidden');
            return false;
        }

        const parts = birthDateValue.split('-');
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const year = parseInt(parts[2], 10);

        const birthDate = new Date(year, month - 1, day);
        if (birthDate.getDate() !== day || birthDate.getMonth() !== month - 1 || birthDate.getFullYear() !== year) {
            ageValidation.textContent = 'Неверная дата';
            ageValidation.className = 'field-validation error';
            birthDateCheckmark.classList.remove('visible');
            romanticSection.classList.add('hidden');
            agreementText.classList.add('hidden');
            return false;
        }

        const today = new Date();
        const age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();

        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }

        ageValidation.textContent = '';
        ageValidation.className = 'field-validation';
        birthDateCheckmark.classList.add('visible');

        if (age >= 18) {
            romanticSection.classList.remove('hidden');
        } else {
            romanticSection.classList.add('hidden');
            datingSection.classList.add('hidden');
            agreementText.classList.add('hidden');
            romanticInterest.checked = false;
        }

        return true;
    }

    // Обработка галочки романтических отношений
    romanticInterest.addEventListener('change', function() {
        if (this.checked) {
            datingSection.classList.remove('hidden');
            agreementText.classList.remove('hidden');
        } else {
            datingSection.classList.add('hidden');
            agreementText.classList.add('hidden');
            locationStatus.textContent = '';
        }
    });

    // Валидация email
    emailInput.addEventListener('input', function() {
        validateEmail();
    });

    function validateEmail() {
        const email = emailInput.value;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!email) {
            emailCheckmark.classList.remove('visible');
            return false;
        }

        if (!emailRegex.test(email)) {
            emailCheckmark.classList.remove('visible');
            return false;
        } else {
            emailCheckmark.classList.add('visible');
            return true;
        }
    }

    // Получение геолокации
    shareLocationBtn.addEventListener('click', function() {
        if (!navigator.geolocation) {
            locationStatus.textContent = 'Геолокация не поддерживается вашим браузером';
            locationStatus.className = 'field-validation error';
            return;
        }

        locationStatus.textContent = 'Определение местоположения...';
        locationStatus.className = 'field-validation';

        navigator.geolocation.getCurrentPosition(
            function(position) {
                const locationData = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                };
                shareLocationBtn.dataset.location = JSON.stringify(locationData);
                locationStatus.textContent = 'Местоположение определено!';
                locationStatus.className = 'field-validation';
            },
            function(error) {
                let errorMessage = 'Ошибка получения местоположения';
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        errorMessage = 'Доступ к геолокации запрещен';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMessage = 'Информация о местоположении недоступна';
                        break;
                    case error.TIMEOUT:
                        errorMessage = 'Время запроса местоположения истекло';
                        break;
                }
                locationStatus.textContent = errorMessage;
                locationStatus.className = 'field-validation error';
            }
        );
    });

    // Отправка формы регистрации
    registrationForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const userId = await getUserId();
        if (!userId) {
            alert('Не удалось определить ID пользователя. Пожалуйста, откройте приложение через Telegram.');
            return;
        }

        if (!validateNickname()) {
            alert('Пожалуйста, укажите корректный никнейм (только латинские буквы, 6-15 символов)');
            return;
        }

        if (!validateBirthDate()) {
            alert('Пожалуйста, укажите корректную дату рождения в формате ДД-ММ-ГГГГ');
            return;
        }

        if (!validateEmail()) {
            alert('Пожалуйста, укажите корректный email адрес');
            return;
        }

        const genderInput = document.querySelector('input[name="gender"]:checked');
        if (!genderInput) {
            alert('Пожалуйста, выберите пол');
            return;
        }

        const formData = {
            user_id: parseInt(userId),
            nickname: document.getElementById('nickname').value,
            email: document.getElementById('email').value,
            birthday: document.getElementById('birth_date').value,
            gender: genderInput.value,
            intro: document.getElementById('about').value,
            dating: romanticInterest.checked,
            location: shareLocationBtn.dataset.location ?
                JSON.parse(shareLocationBtn.dataset.location) : null
        };

        if (romanticInterest.checked) {
            formData.dating_agreement = true;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/register`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData)
            });

            if (response.ok) {
                const result = await response.json();
                showPage(roomPage);
                initRoom();
            } else {
                const error = await response.json();
                alert(`Ошибка регистрации: ${error.detail || 'Неизвестная ошибка'}`);
            }
        } catch (error) {
            alert('Ошибка соединения с сервером');
            console.error('Registration error:', error);
        }
    });

    function showPage(page) {
        // Сначала скрываем все страницы
        document.querySelectorAll('.page').forEach(p => {
            p.classList.remove('active');
            p.style.display = 'none';
        });

        // Затем показываем нужную страницу
        page.classList.add('active');
        page.style.display = 'flex';

        // Анимация появления для не-загрузочных страниц
        if (page.id !== 'loadingPage') {
            page.style.animation = 'fadeIn 0.5s ease-out';
        }
    }

    // Запускаем инициализацию приложения
    initializeApp();
});