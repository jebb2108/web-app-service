from typing import Optional

from pydantic import BaseModel, Field


class Word(BaseModel):
    """
    Модель слова пользователя (для базы данных)
    """
    user_id: int = Field(..., description="Уникальный идентификатор пользователя")
    word: Optional[str] = Field(None, description="Слово, которое нужно добавить в словарь")
    translations: Optional[dict] = Field(None, description="Перевод слова")
    is_public: bool = Field(False, description="Видно ли слово остальным пользователям")
    context: Optional[str] = Field(None, description="Контекст к слову")
    audio: Optional[bytes] = Field(None, description="bytes of audio recording")


class Profile(BaseModel):
    """
    Модель профиля пользователя (для базы данных)
    """
    user_id: int = Field(..., description="User ID")
    nickname: str = Field(..., description="Уникальный никнейм пользователя")
    email: str = Field(..., description="Email пользователя")
    gender: str = Field(..., description="Пол пользователя")
    intro: str = Field(..., description="Краткая информация о пользователе")
    birthday: str = Field(..., description="Дата рождения пользователя (ISO format)")
    dating: Optional[bool] = Field(False, description="Согласие на дэйтинг")
    status: Optional[str] = Field('rookie', description="Видимый статус пользователя")