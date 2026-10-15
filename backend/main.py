import os
from contextlib import asynccontextmanager
from typing import Annotated, Literal

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Path, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import Client, create_client

load_dotenv()

CardStatus = Literal["todo", "doing", "done"]


class CardCreate(BaseModel):
    title: str


class CardUpdate(BaseModel):
    status: CardStatus


class Card(BaseModel):
    id: int
    title: str
    status: CardStatus
    created_at: str


@asynccontextmanager
async def lifespan(app: FastAPI):
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_KEY")
    if not supabase_url or not supabase_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set")

    app.state.supabase = create_client(supabase_url, supabase_key)
    yield


app = FastAPI(title="Kanban Board API", lifespan=lifespan)

allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)


def get_supabase(request: Request) -> Client:
    return request.app.state.supabase


@app.get("/cards", response_model=list[Card])
def list_cards(client: Annotated[Client, Depends(get_supabase)]):
    return client.table("cards").select("*").order("created_at").execute().data


@app.post("/cards", response_model=Card, status_code=status.HTTP_201_CREATED)
def create_card(
    body: CardCreate,
    client: Annotated[Client, Depends(get_supabase)],
):
    result = (
        client.table("cards")
        .insert({"title": body.title, "status": "todo"})
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=502, detail="The card could not be created")
    return result.data[0]


@app.patch("/cards/{card_id}", response_model=Card)
def update_card(
    body: CardUpdate,
    client: Annotated[Client, Depends(get_supabase)],
    card_id: Annotated[int, Path(gt=0)],
):
    result = (
        client.table("cards")
        .update({"status": body.status})
        .eq("id", card_id)
        .select("*")
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Card not found")
    return result.data[0]


@app.delete("/cards/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_card(
    client: Annotated[Client, Depends(get_supabase)],
    card_id: Annotated[int, Path(gt=0)],
):
    client.table("cards").delete().eq("id", card_id).execute()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
