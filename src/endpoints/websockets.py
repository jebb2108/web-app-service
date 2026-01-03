import json
from datetime import datetime
from typing import TYPE_CHECKING, Optional, Dict

import httpx
from fastapi import WebSocket, APIRouter, Query, WebSocketDisconnect, HTTPException
from starlette import status

from src.config import config
from src.dependencies import get_ws_connection
from src.logconf import opt_logger as log
from src.models import MessageContent
from src.validators.tokens import convert_token, validate_access

if TYPE_CHECKING:
    from src.services.connection import ConnectionService


router = APIRouter()
logger = log.setup_logger("websockets")



@router.websocket("/ws/chat")
async def websocket_chat(
        websocket: WebSocket,
        room_id: str = Query(..., alias="room_id"),
        token: str = Query(..., alias="token"),
):
    """Обработчик подключения клиента к чату"""

    logger.info(f"=== NEW CONNECTION ATTEMPT ===")
    logger.info(f"Room ID: {room_id}")

    connection: "ConnectionService" = await get_ws_connection()

    try:
        # Проверяем токен и получаем данные пользователя
        userdata = convert_token(token)
        username = userdata["nickname"]

        logger.info(f"User: {username}")

        if not room_id or not username:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Проверка валидности токена и прав доступа к комнате
        is_valid = await validate_access(token, room_id)
        if not is_valid:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Подключаем пользователя
        success = await connection.connect(websocket, room_id, {
            "nickname": username,
            "token": token
        })

        if not success:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
            return

        # Отправляем информацию о пользователе
        await connection.send_personal_message({
            "type": "user_info",
            "username": username
        }, websocket)

        # Отправляем историю сообщений
        history = await get_message_history(room_id)
        await connection.send_personal_message({
            "type": "message_history",
            "messages": history
        }, websocket)

        logger.info(f"User {username} successfully connected to room {room_id}")

        # Основной цикл обработки сообщений
        try:
            while True:
                # Ожидаем сообщение от клиента
                data = await websocket.receive_text()
                message_data = json.loads(data)

                # Обрабатываем отправку сообщения
                await handle_send_message(websocket, message_data)

        except WebSocketDisconnect:
            logger.info(f"User {username} disconnected from room {room_id}")

        except Exception as e:
            logger.error(f"Error in WebSocket connection: {e}")

    except Exception as e:
        logger.error(f"Connection error: {e}")
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)

    finally:
        # Всегда отключаем при завершении
        await connection.disconnect(websocket)


async def handle_send_message(websocket: WebSocket, message_data: dict):
    """Обработка отправки сообщения"""

    connection: "ConnectionService" = await get_ws_connection()

    # Получаем сессию пользователя
    session = await connection.get_user_session(websocket)
    if not session:
        return

    room_id = session.get("room_id")
    username = session.get("username", "Anonymous")

    if not room_id:
        return

    # Создаем объект сообщения
    message_content = MessageContent(
        sender=username,
        text=message_data.get("text", ""),
        created_at=datetime.now(
            tz=config.TZINFO
        ).isoformat(timespec="milliseconds"),
        room_id=room_id,
    )

    # Сохранение сообщения в Redis
    await save_message(message_content)

    # Отправка сообщения всем в комнате
    await connection.broadcast_to_room({
        "type": "new_message",
        "message": message_content.model_dump()
    }, room_id)


async def get_message_history(room_id: str) -> Optional[Dict[str, str]]:
    """Получение истории сообщений"""
    try:
        async with httpx.AsyncClient() as client:
            url = config.worker.url + config.worker.prefix + \
                  f'/api/messages?room_id={room_id}'
            resp = await client.get(url=url)
            if resp.status_code == 200:
                return resp.json()
            else:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)

    except Exception as e:
        logger.error(f"Error saving message onto ext server: {e}")
        raise HTTPException(status_code=500, detail='Internal Server Error')


async def save_message(message_data: "MessageContent"):
    """Сохранение сообщения в Redis"""
    try:
        async with httpx.AsyncClient() as client:
            url = config.worker.url + config.worker.prefix + \
                  f'/messages?room_id={message_data.room_id}'
            resp = await client.post(url=url, content=message_data.model_dump_json())
            if resp.status_code == 200:
                return 200
            else:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)

    except Exception as e:
        logger.error(f"Error saving message onto ext server: {e}")
        raise HTTPException(status_code=500, detail='Internal Server Error')