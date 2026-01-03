from datetime import datetime, timedelta

import jwt

from src.config import config
from src.exc import FailToCreateToken


async def create_token(user_id, nickname, room_id, exp: timedelta = timedelta(minutes=15)):
    """Функция для выдачи уникального токена пользоватеою, содержащую его данные"""
    try:

        time_obj = datetime.now(tz=config.tzinfo) + exp

        payload = {
            "user_id": user_id,
            "nickname": nickname,
            "room_id": room_id,
            "expires_at": time_obj.isoformat(),
        }

        token = jwt.encode(payload=payload, key=config.secret_key, algorithm="HS256")
        return token

    except Exception:
        raise FailToCreateToken


def convert_token(token: str):
    """Декодирует токен по секретному ключу"""
    return jwt.decode(jwt=token, key=config.SECRET_KEY, algorithms=["HS256"])


async def validate_access(token: str, room_id: str) -> bool:
    user_data = convert_token(token)
    print(f"user data {user_data}")
    print(f"room_id from token: {user_data.get('room_id')}, room_id from query: {room_id}")
    if user_data.get("room_id") == room_id:
        print("Аутентификация прошла успешно")
        return True
    print("Некоректный token!")
    return False
