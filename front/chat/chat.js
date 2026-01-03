const API_WS_URL = 'wss://chat.lllang.site';
const WORKER_API_URL = 'https://chat.lllang.site/api/worker';
const CHAT_API_URL = 'https://chat.lllang.site/api/user'

// Получаем room_id и token из URL параметров
const urlParams = new URLSearchParams(window.location.search);
const userId = urlParams.get('user_id');
const matchId = urlParams.get('match_id');
const roomId = urlParams.get('room_id');
const token = urlParams.get('token');

if (!roomId || !token) {
    console.error('Room ID or Token missing');
}

// Переменные для хранения состояния
let userName = '';
let websocket;
let partnerConnected = false;
let timerInterval;
let partnerNickname = null;
let partnerDiscovered = false;
let sessionEnded = false; // Флаг завершения сессии

// Подключаемся к WebSocket серверу
function connectWebSocket() {
    const wsUrl = `${API_WS_URL}/ws/chat?room_id=${roomId}&token=${token}`;
    websocket = new WebSocket(wsUrl);

    websocket.onopen = function() {
        console.log('WebSocket connection established');
        showWaitingInterface();
        
        // Таймер блокировки чата через 15 минут
        setTimeout(() => {
            endSession();
        }, 900000);
    };

    websocket.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            handleWebSocketMessage(data);
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };

    websocket.onclose = function() {
        console.log('WebSocket connection closed');
    };

    websocket.onerror = function(error) {
        console.error('WebSocket error:', error);
    };
}

// Функция для установки ника партнера
function setPartnerNickname(nickname) {
    if (nickname && nickname !== userName) {
        partnerNickname = nickname;
        document.getElementById('partnerNickname').textContent = nickname;
        console.log('Partner nickname set to:', nickname);
        
        // Если партнер подключился, но интерфейс еще не переключен
        if (!partnerConnected) {
            switchToChatInterface();
        }
        return true;
    }
    return false;
}

// Показать интерфейс ожидания
function showWaitingInterface() {
    document.getElementById('waitingContainer').style.display = 'flex';
    hidePartnerLeftInterface();
    document.querySelector('.connected-header').style.display = 'none';
    document.querySelector('.input-container').style.display = 'none';
    document.querySelector('.waiting-header').style.display = 'flex';
    
    startWaitTimer();
}

// Запуск таймера ожидания
function startWaitTimer() {
    let timeLeft = 30;
    const timerElement = document.getElementById('waitingTimer');
    const progressCircle = document.querySelector('.timer-progress');
    const circumference = 2 * Math.PI * 54;
    
    // Сбросим предыдущий интервал, если он существует
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    
    const updateProgress = () => {
        const offset = circumference - (timeLeft / 30) * circumference;
        progressCircle.style.strokeDashoffset = offset;
    };
    
    updateProgress();
    
    timerInterval = setInterval(() => {
        timeLeft--;
        timerElement.textContent = timeLeft;
        updateProgress();
        
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            endSession('No partner found. Please try again.');
        }
    }, 1000);
}

// Обновление статуса партнера
function updatePartnerStatus(isOnline) {
    const partnerStatusElement = document.getElementById('partnerStatus');
    if (partnerStatusElement) {
        partnerStatusElement.className = isOnline ? 'status-indicator online' : 'status-indicator offline';
    }
    
    // Если партнер онлайн, но ник еще не установлен, используем "Partner"
    if (isOnline && !partnerNickname && !partnerConnected) {
        switchToChatInterface();
    }
}

// Переключение на интерфейс чата
function switchToChatInterface() {
    // Скрываем интерфейс ожидания и интерфейс после выхода партнера
    document.querySelector('.waiting-header').style.display = 'none';
    document.getElementById('waitingContainer').style.display = 'none';
    hidePartnerLeftInterface();
    
    // Показываем интерфейс чата
    document.querySelector('.connected-header').style.display = 'flex';
    document.querySelector('.input-container').style.display = 'flex';
    
    // Обновляем имя партнера
    if (partnerNickname) {
        document.getElementById('partnerNickname').textContent = partnerNickname;
    }
    
    // Устанавливаем статус партнера в онлайн
    updatePartnerStatus(true);
    
    // Очищаем таймер ожидания
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    
    partnerConnected = true;
    partnerDiscovered = true;
    
    console.log('Switched to chat interface');
}

// Показать интерфейс после выхода партнера
function showPartnerLeftInterface() {
    // Скрываем поле ввода сообщений
    document.querySelector('.input-container').style.display = 'none';
    
    // Показываем баннер под шапкой и кнопку внизу
    document.getElementById('partnerLeftBanner').style.display = 'block';
    document.getElementById('partnerLeftButton').style.display = 'block';
    
    // Обновляем статус партнера на оффлайн
    updatePartnerStatus(false);
    
    console.log('Partner left interface shown');
}

// Скрыть интерфейс после выхода партнера
function hidePartnerLeftInterface() {
    document.getElementById('partnerLeftBanner').style.display = 'none';
    document.getElementById('partnerLeftButton').style.display = 'none';
}

// Обработчик сообщений от сервера
function handleWebSocketMessage(data) {
    console.log('Received WebSocket message:', data);
    
    switch(data.type) {
        case 'user_info':
            userName = data.username;
            console.log('User identified as:', userName);
            break;
            
        case 'message_history':
            // Отображаем историю сообщений
            data.messages.forEach(msg => {
                addMessageToChat(msg, msg.sender === userName);
                
                // Если есть сообщения от других пользователей, устанавливаем ник партнера
                if (msg.sender !== userName && !partnerDiscovered) {
                    setPartnerNickname(msg.sender);
                }
            });
            
            // Проверяем, есть ли сообщения от партнера в истории
            const hasPartnerMessages = data.messages.some(msg => msg.sender !== userName);
            if (hasPartnerMessages && !partnerConnected) {
                switchToChatInterface();
            }
            break;
            
        case 'new_message':
            // Устанавливаем ник отправителя как партнера
            if (data.message.sender !== userName && !partnerDiscovered) {
                setPartnerNickname(data.message.sender);
            }
            
            addMessageToChat(data.message, data.message.sender === userName);
            
            // Если это сообщение от партнера и мы еще не в режиме чата
            if (data.message.sender !== userName && !partnerConnected) {
                switchToChatInterface();
            }
            break;
            
        case 'partner_status':
            updatePartnerStatus(data.is_online);
            break;

        case 'user_status':
            if (data.username !== userName) {
                // Устанавливаем ник партнера при изменении статуса
                if (!partnerDiscovered) {
                    setPartnerNickname(data.username);
                }
                updatePartnerStatus(data.is_online);
            }
            break;

        case 'online_users':
            // Устанавливаем ник первого онлайн пользователя как партнера
            const otherUsers = data.users.filter(user => user !== userName);
            if (otherUsers.length > 0 && !partnerDiscovered) {
                setPartnerNickname(otherUsers[0]);
            }
            break;

        // Обработка уведомлений о завершении сессии
        case 'session_ended':
        case 'match_aborted':
        case 'match_exited':
            handleSessionEnded(data.reason || 'Session has been terminated.');
            break;
            
        // Обработка выхода партнера
        case 'user_exited':
            handlePartnerExited(data.reason || 'Partner left the chat');
            break;
    }
}

// Обработка выхода партнера
function handlePartnerExited(reason) {
    if (sessionEnded) return;
    
    console.log('Partner exited:', reason);
    
    // Блокируем возможность отправки сообщений
    document.getElementById('messageInput').disabled = true;
    document.getElementById('sendButton').disabled = true;
    
    // Показываем системное сообщение о выходе партнера в чате
    const container = document.getElementById('messagesContainer');
    const partnerLeftMessage = document.createElement('div');
    partnerLeftMessage.className = 'partner-left-system-message';
    partnerLeftMessage.textContent = "Partner left the chat";
    container.appendChild(partnerLeftMessage);
    
    // Показываем интерфейс "Partner Left"
    showPartnerLeftInterface();
    
    // Устанавливаем флаг завершения сессии
    sessionEnded = true;
}

// Функция для уведомления сервера чата о завершении сессии
async function notifyChatServer(reason) {
    try {
        const response = await fetch(`${WORKER_API_URL}/notify_session_end`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                room_id: roomId,
                reason: reason
            })
        });
        
        if (!response.ok) {
            throw new Error('Chat server notification failed');
        }
        
        return await response.json();
    } catch (error) {
        console.error('Error notifying chat server:', error);
        // Продолжаем выполнение даже если этот запрос не удался
        // Пользователь все равно должен иметь возможность выйти
    }
}

// Функция блокировки UI
function setUILocked(locked) {
    const exitButton = document.getElementById('exitButton');
    const cancelButton = document.querySelector('.cancel-button');
    
    if (exitButton) exitButton.disabled = locked;
    if (cancelButton) cancelButton.disabled = locked;
    
    // Можно добавить спиннер загрузки при необходимости
    if (locked) {
        // Показать индикатор загрузки
        console.log('UI locked');
    } else {
        // Скрыть индикатор загрузки
        console.log('UI unlocked');
    }
}

// Функция обработки завершения сессии
function handleSessionEnded(reason) {
    if (sessionEnded) return; // Если сессия уже завершена, ничего не делаем
    
    sessionEnded = true;
    console.log('Session ended by server:', reason);
    
    // Блокируем возможность отправки сообщений
    document.getElementById('messageInput').disabled = true;
    document.getElementById('sendButton').disabled = true;
    
    // Показываем интерфейс "Partner Left"
    showPartnerLeftInterface();
    
    // Останавливаем все таймеры
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    
    // Обновляем статус партнера на оффлайн
    updatePartnerStatus(false);
    
    // Закрываем WebSocket соединение
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.close();
    }
}

// Функция завершения сессии (локальная)
function endSession(reason) {
    if (sessionEnded) return;
    
    console.log('Ending session:', reason);
    
    sessionEnded = true;
    
    if (websocket) {
        websocket.close();
    }
    
    document.getElementById('messageInput').disabled = true;
    document.getElementById('sendButton').disabled = true;

    // Показываем интерфейс "Partner Left"
    showPartnerLeftInterface();
    
    // Останавливаем таймер
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

// Функция добавления сообщения в чат
function addMessageToChat(messageData, isMyMessage = false) {
    // Если сессия завершена, не добавляем новые сообщения
    if (sessionEnded) return;
    
    const container = document.getElementById('messagesContainer');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isMyMessage ? 'my-message' : 'other-message'}`;

    let messageTime;
    const date = new Date(messageData.created_at);
    
    if (isNaN(date.getTime())) {
        messageTime = "now";
    } else {
        messageTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    
    const messageText = document.createElement('div');
    messageText.className = 'message-text';
    messageText.textContent = messageData.text;

    const messageTimeElement = document.createElement('div');
    messageTimeElement.className = 'message-time';
    messageTimeElement.textContent = messageTime;

    messageContent.appendChild(messageText);
    messageContent.appendChild(messageTimeElement);
    messageDiv.appendChild(messageContent);

    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;

    // Определяем, короткое ли сообщение (одна строка)
    setTimeout(() => {
        const textHeight = messageText.offsetHeight;
        const lineHeight = parseFloat(getComputedStyle(messageText).lineHeight);
        // Считаем, что если высота текста не более 1.5 lineHeight, то это одна строка
        const isShortMessage = textHeight <= lineHeight * 1.5;
        
        if (isShortMessage) {
            messageContent.classList.add('short-message');
        } else {
            messageContent.classList.remove('short-message');
        }
    }, 0);
}

// Функция отправки сообщения
function sendMessage() {
    // Если сессия завершена, блокируем отправку сообщений
    if (sessionEnded) {
        return;
    }
    
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();

    if (message && websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({ text: message }));
        messageInput.value = '';
    }
}

// Функции для меню
function handleReport() {
    alert('Report function will be implemented');
    document.querySelector('.dropdown-menu').classList.remove('show');
}

async function handleExit(is_aborted) {
    if (confirm('Are you sure you want to exit the chat?')) {
        setUILocked(true);
        try {
            const message = is_aborted ? "Session aborted by user" : "Session exited by user";
            // 1. Сначала уведомляем сервер чата о завершении сессии
            await notifyChatServer(message);
            
            // 2. Затем меняем статус на сервере очереди
            const cancelResponse = await fetch(
                `${WORKER_API_URL}/cancel_match?user_id=${userId}&is_aborted=${is_aborted}`
            );
            
            if (cancelResponse.ok) {
                const result = await cancelResponse.json();
                if (result.status === "success") {
                    window.location.href = `/index.html?user_id=${userId}`;
                } else {
                    throw new Error('Queue server returned failure');
                }
            } else {
                throw new Error('Failed to update queue server');
            }
        } catch (error) {
            console.error('Error exiting chat:', error);
            alert('Error exiting chat. Please try again.');
            setUILocked(false);
        }
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    connectWebSocket();
    
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    
    if (messageInput) {
        messageInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    }
    
    if (sendButton) {
        sendButton.addEventListener('click', sendMessage);
    }
    
    // Обработчик для выпадающего меню
    document.querySelector('.menu-dots').addEventListener('click', function(e) {
        e.stopPropagation();
        document.querySelector('.dropdown-menu').classList.toggle('show');
    });
    
    // Обработчик для кнопки Exit
    document.getElementById('exitButton').addEventListener('click', function(e) {
        e.stopPropagation();
        handleExit(false);
        document.querySelector('.dropdown-menu').classList.remove('show');
    });
    
    // Обработчик для кнопки поиска нового партнера
    document.getElementById('searchNewPartnerButton').addEventListener('click', function() {
        handleExit(false);
    });
    
    document.addEventListener('click', function() {
        document.querySelector('.dropdown-menu').classList.remove('show');
    });
});