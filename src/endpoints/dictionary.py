from typing import List

import httpx
from fastapi import APIRouter, HTTPException, Query, Response

from src.config import config
from src.logconf import opt_logger as log
from src.models.dict_models import Word

router = APIRouter(prefix="/api")
logger = log.setup_logger('dictionary_endpoints')


@router.get("/words")
async def api_words_handler(
    user_id: int = Query(..., description="User ID"),
) -> List[dict]:
    async with httpx.AsyncClient() as client:
        url = config.gateway.url + f'/api/words?user_id={user_id}'
        resp = await client.get(url=url)
        if resp.status_code == 200:

            # Пытается преобразовать из формата json
            try:
                data = resp.json()
                user_words_ls = data.get(str(user_id), [])

            except: # noqa
                user_words_ls = []

            return [dict(item) for item in user_words_ls]


        else:
            raise HTTPException(
                status_code=resp.status_code, detail=resp.text
            )


@router.post("/words")
async def api_add_word_handler(request: Word,):
    """ Добавить новое слово в словарь """
    async with httpx.AsyncClient() as client:
        url = config.gateway.url + f'/api/words?user_id={request.user_id}'
        resp = await client.post(url=url, content=request.model_dump_json())
        if resp.status_code == 200:
            return Response(status_code=200)

        logger.warning('Malfunction occured in api_add_word_handler')
        raise HTTPException(status_code=resp.status_code, detail=resp.text)


@router.put('/words')
async def api_edit_word_handler(request: Word,):
    """ Изменить уже существующее слово в словаре """
    async with httpx.AsyncClient() as client:
        url = config.gateway.url + f'/api/words?user_id={request.user_id}'
        resp = await client.put(url=url, content=request.model_dump_json())
        if resp.status_code == 200:
            return Response(status_code=200)

        logger.warning('Malfunction occured in api_add_word_handler')
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

@router.delete("/words")
async def api_delete_word_handler(
    user_id: int = Query(..., description="User ID"),
    word_id: int = Query(..., description="Word ID which it goes by in DB"),
):
    try:
        async with httpx.AsyncClient() as client:
            url = config.gateway.url + f'/api/words?user_id={user_id}&word_id={word_id}'
            resp = await client.delete(url=url)
            if resp.status_code == 200:
                return Response(status_code=200)

            logger.warning('Malfunction occured in api_delete_word_handler')
            raise HTTPException(status_code=resp.status_code, detail=resp.text)

    except Exception as e:
        logger.error(f"Error in api_delete_word_handler: {str(e)}")
        raise HTTPException(status_code=500, detail="Server not responding")



@router.get("/words/search")
async def api_search_word_handler(
        user_id: int = Query(..., description="User ID пользователя"),
        word: str = Query(..., description="Слово для поиска среди пользователей"),
):
    try:
        # Ищем слово от других участников
        async with httpx.AsyncClient() as client:

            # Отправляет два запроса на gateway сервер
            user_word_resp = await client.get(
                url=config.gateway.url + f'/api/words/search?user_id={user_id}&word={word}'
            )
            all_words_resp = await client.get(
                url=config.gateway.url + f'/api/words/search?word={word}'
            )


            if not user_word_resp.status_code == 200 and user_word_resp.status_code != 204:
                logger.warning('Malfunction occured in api_search_word_handler')
                raise HTTPException(
                    status_code=user_word_resp.status_code, detail=user_word_resp.text
                )
            if not all_words_resp.status_code == 200 and all_words_resp.status_code != 204:
                logger.warning('Malfunction occured in api_search_word_handler')
                raise HTTPException(
                    status_code=all_words_resp.status_code, detail=all_words_resp.text
                )

            # Если два запроса прошли успешно,
            # то конвертируем resp объекты в словарики

            user_word, all_user_words = None, None

            if user_word_resp.status_code == 200:
                # Пытается преобразовать resp объект
                user_data = user_word_resp.json().get(str(user_id), [])
                user_word = user_data.pop() if user_data else {}

                logger.debug(f'user word: {user_word}')

            if all_words_resp.status_code == 200:
                # Пытается преобразовать resp объект
                all_user_words = all_words_resp.json()
                # у всех пользователей не должно быть собственного слова
                if str(user_id) in all_user_words:
                    del all_user_words[str(user_id)]

                logger.debug(f'all words: {all_user_words}')


            # возвращает полученные слова
            return {"user_word": user_word, "all_users_words": all_user_words}



    except Exception as e:
        logger.error(f"Error in api_search_word_handler: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/stats")
async def api_stats_handler(
        user_id: int = Query(..., description="USer ID")
):
    """ Обработчик статистики слов пользователя """
    try:
        async with httpx.AsyncClient() as client:
            url = config.gateway.url + f'/api/words/stats?user_id={user_id}'
            resp = await client.get(url=url)
            if resp.status_code == 200:
                data = resp.json()
                logger.info(f'data: {data}')
                return resp.json()
            elif resp.status_code == 204:
                return {}
            else:
                raise HTTPException(
                    status_code=resp.status_code, detail=resp.text
                )

    except Exception as e:
        logger.error(f"Error in api_stats_handler: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")