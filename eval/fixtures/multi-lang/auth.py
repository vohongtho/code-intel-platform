"""Multi-file fixture for eval — authentication module"""

class User:
    def __init__(self, name: str, email: str):
        self.name = name
        self.email = email
        self.is_authenticated = False

class AuthService:
    def __init__(self):
        self._users: dict[str, User] = {}
        self._sessions: dict[str, str] = {}

    def register(self, name: str, email: str) -> User:
        user = User(name, email)
        self._users[email] = user
        return user

    def login(self, email: str, password: str) -> str:
        user = self._find_user(email)
        if not user:
            raise ValueError("User not found")
        token = self._generate_token(email)
        self._sessions[token] = email
        user.is_authenticated = True
        return token

    def logout(self, token: str) -> None:
        email = self._sessions.pop(token, None)
        if email and email in self._users:
            self._users[email].is_authenticated = False

    def _find_user(self, email: str):
        return self._users.get(email)

    def _generate_token(self, email: str) -> str:
        return f"tok_{hash(email)}"

def validate_email(email: str) -> bool:
    return "@" in email and "." in email.split("@")[-1]
