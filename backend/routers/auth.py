from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest):
    # TODO: Validate credentials against database / config
    if body.username == "admin" and body.password == "admin":
        return LoginResponse(access_token="dummy-token")
    raise HTTPException(status_code=401, detail="Invalid credentials")


@router.post("/logout")
def logout():
    # TODO: Invalidate session / token
    return {"message": "Logged out"}
