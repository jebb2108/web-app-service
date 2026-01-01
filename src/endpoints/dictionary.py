import httpx
from fastapi import APIRouter, HTTPException, Query

from src.config import config
from src.logconf import opt_logger as log
from src.models.dict_models import Word

router = APIRouter(prefix="/api")
logger = log.setup_logger('dictionary_endpoints')


@router.get("/words")
async def api_words_handler(
    user_id: int = Query(..., description="User ID"),
):
    async with httpx.AsyncClient() as client:
        url = config.gateway.url + f'/api/words?user_id={user_id}'
        resp = await client.get(url=url)
        if resp.status_code == 200:
            data = resp.json()
            user_words_ls = data.get(str(user_id), {})
            return [ dict(item) for item in user_words_ls ]
        else:
            raise HTTPException(
                status_code=resp.status_code, detail=resp.text
            )


@router.post("/words")
async def api_add_word_handler(request: Word,):

    async with httpx.AsyncClient() as client:
        url = config.gateway.url + f'/api/words?user_id={request.user_id}'
        resp = await client.post(url=url, content=request.model_dump_json())
        if resp.status_code == 200:
            logger.info("Word`s been loaded, and cache`s been removed")
            return 200
        else:
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
                return 200
            else:
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
            user_word_resp = await client.get(
                url=config.gateway.url + f'/api/words/search?user_id={user_id}&word={word}'
            )
            all_words_resp = await client.get(
                url=config.gateway.url + f'/api/words/search?word={word}'
            )

            if not user_word_resp.status_code == 200:
                raise HTTPException(
                    status_code=user_word_resp.status_code, detail=user_word_resp.text
                )
            if not all_words_resp.status_code == 200:
                raise HTTPException(
                    status_code=all_words_resp.status_code, detail=all_words_resp.text
                )
            # Если два запроса прошли успешно,
            # то конвертируем resp объекты в словарики
            user_word = user_word_resp.json()
            all_user_words = all_words_resp.json()
            # От лица пользователя не должно быть слова от
            # самого пользователя в словаре других пользователей, соответсвенно удаляем
            if str(user_id) in all_user_words:
                del all_user_words[str(user_word)]

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
            else:
                raise HTTPException(
                    status_code=resp.status_code, detail=resp.text
                )

    except Exception as e:
        logger.error(f"Error in api_stats_handler: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")