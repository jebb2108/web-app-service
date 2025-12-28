from typing import TYPE_CHECKING

import httpx
from fastapi import HTTPException, APIRouter
from fastapi.params import Query

from src.config import config
from src.dependencies import get_ws_connection
from src.logconf import opt_logger as log
from src.models import UserIdRequest, MatchRequestModel

if TYPE_CHECKING:
    from src.services.connection import ConnectionService

logger = log.setup_logger("matchmaking")

router = APIRouter(prefix='/api/worker')


@router.get('/check_match')
async def check_match(user_id: int = Query(..., description="User ID")):
    async with httpx.AsyncClient() as client:
        url = config.worker.url + config.worker.prefix + \
              f'/check_match?user_id={user_id}'
        resp = await client.get(url=url)
        if resp.status_code == 200:
            return resp.json()
        else:
            return False

@router.get('/queue/status')
async def get_queue_status():
    async with httpx.AsyncClient() as client:
        url = config.worker.url + config.worker.prefix + \
            f'/queue/status'
        resp = await client.get(url=url)
        if resp.status_code == 200:
            return resp.json()

@router.get('/queue/{user_id}/status')
async def get_queue_status(user_id: int):
    async with httpx.AsyncClient() as client:
        url = config.worker.url + config.worker.prefix + \
            f'/queue/{user_id}/status'
        resp = await client.get(url=url)
        if resp.status_code == 200:
            return resp.json()

@router.post('/match/toggle')
async def toggle_match_handler(request: UserIdRequest):
    try:
        async with httpx.AsyncClient() as client:
            url = config.gateway.url + f'/api/users?user_id={request.user_id}&target_field=all'
            resp = await client.get(url=url)
            data = resp.json()
            logger.info('user data info: %s', data)
            if data and resp.status_code == 200:
                user_data= {
                    'user_id': request.user_id,
                    'username': data.get("username"),
                    'gender': data.get('gender'),
                    'criteria': {
                        'language': data.get('language'),
                        'fluency': data.get('fluency'),
                        'topics': data.get('topics'),
                        'dating': data.get('dating')
                    },
                    'lang_code': data.get('lang_code'),
                    'action': 'join'
                }
                match_request = MatchRequestModel(**user_data)
                url = config.worker.url + config.worker.prefix + '/match/toggle'

                # Добавляем таймаут и заголовки
                resp = await client.post(
                    url=url,
                    content=match_request.model_dump_json(),
                    headers={"Content-Type": "application/json"},
                    timeout=30.0
                )
                logger.info('response data: %s', resp.json())

                if resp.status_code == 200:
                    return resp.json()
                else:
                    raise HTTPException(
                        status_code=resp.status_code,
                        detail=resp.text
                    )
            else:
                raise HTTPException(
                    status_code=404,
                    detail='Failed to load user data!'
                )

    except Exception as e:
        logger.error(f"Error notifying session end: {e}")
        raise HTTPException(status_code=500, detail=str(e))


###### HTTP endpoints для взаимодействия с чатом ######
@router.get("/chat/rooms/{room_id}/status")
async def get_room_status(room_id: str):
    """Получение статуса комнаты"""
    connection: "ConnectionService" = await get_ws_connection()

    online_users = connection.get_online_users(room_id)
    return {
        "room_id": room_id,
        "user_count": len(online_users),
        "online_users": online_users
    }


@router.post("/notify_session_end")
async def notify_session_end(request: dict):
    """Уведомление всех участников комнаты о завершении сессии"""
    try:
        logger.info(f"=== NOTIFY_SESSION_END CALLED ===")
        logger.info(f"Request data: {request}")

        room_id = request.get("room_id")
        reason = request.get("reason", "Session ended")

        if not room_id:
            logger.error("room_id is missing")
            raise HTTPException(status_code=400, detail="room_id is required")

        connection: "ConnectionService" = await get_ws_connection()

        # Логируем информацию о комнате
        logger.info(f"Active connections: {connection.active_connections}")
        logger.info(f"Room {room_id} connections: {connection.active_connections.get(room_id, {})}")

        # Получаем список пользователей в комнате
        users_in_room = list(connection.active_connections.get(room_id, {}).keys())
        logger.info(f"Users in room {room_id}: {users_in_room}")

        # Отправляем уведомление всем в комнате
        await connection.broadcast_to_room({
            "type": "session_ended",
            "reason": reason
        }, room_id)

        logger.info(f"Session end notification sent successfully to room {room_id}")
        return {"status": "success", "message": "Session end notification sent"}

    except Exception as e:
        logger.error(f"Error notifying session end: {e}")
        raise HTTPException(status_code=500, detail=str(e))