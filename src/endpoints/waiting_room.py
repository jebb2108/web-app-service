import httpx
from fastapi import APIRouter, HTTPException
from fastapi.params import Query

from src.config import config
from src.endpoints.matchmaking import logger
from src.exc import FailToCreateToken
from src.models import Profile
from src.validators.tokens import create_token

router = APIRouter(prefix="/api/user")


@router.get("/check_profile")
async def check_profile_exists(
        user_id: str = Query(..., description="User ID")
):
    """ Проверяет, существует ли профиль пользователя в БД """
    try:
        async with httpx.AsyncClient() as client:
            url = config.gateway.url + f'/api/check_profile?user_id={user_id}'
            resp = await client.get(url=url)
            if resp.status_code == 200:
                return {"exists": resp.json()}
            else:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)

    except Exception as e:
        logger.error(f'Error in check_user_handler: {e}')
        raise HTTPException(status_code=500, detail='Internal Server Error')


@router.get("/check_user")
async def check_user_handler(
        user_id: str = Query(..., description="User ID")
):
    """ Проверяет, существует ли пользователь в БД """
    try:
        async with httpx.AsyncClient() as client:
            url = config.gateway.url + f'/api/users?user_id={user_id}'
            resp = await client.get(url=url)
            if resp.status_code == 200:
                return {"exists": resp.json()}
            else:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)

    except Exception as e:
        logger.error(f'Error in check_user_handler: {e}')
        raise HTTPException(status_code=500, detail='Internal Server Error')


@router.put("/register")
async def register_user_handler(
        user_data: Profile,
):
    # Сохранение в базу данных профиля пользователя
    try:
        async with httpx.AsyncClient() as client:
            url = config.gateway.url + f'/api/update_profile'
            resp = await client.put(url=url, content=user_data.model_dump_json())
            if resp.status_code == 200:
                return 200
            else:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)

    except Exception as e:
        logger.error(f'Error in register_user_handler: {e}')
        raise HTTPException(status_code=500, detail='Internal Server Error')

@router.get("/create_token")
async def create_token_handler(
        user_id: int = Query(..., description="ID пользователя"),
        room_id: str = Query(..., description="Уникальный идентификатор комнаты"),
):
    """ Обработчик создания токена """
    try:
        async with httpx.AsyncClient() as client:
            url = config.gateway.url + f'/api/users?user_id={user_id}'
            resp = await client.get(url=url)
            if resp.status_code == 200 and resp.json() is True:
                resp = await client.get(url=config.gateway.url+f'/users?user_id={user_id}&target_field=nickname')
                nickname = resp.json().get('nickname')
                # Создаю токен для аутентификации сессии
                token = await create_token(user_id, nickname, room_id)
                return {"token": token}
            else:
                raise HTTPException(
                    status_code=resp.status_code, detail=resp.text
                )

    except FailToCreateToken:
        raise HTTPException(status_code=500, detail="Error creating token")

    except Exception as e:
        logger.error(f"Error in create_token_handler: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error")
