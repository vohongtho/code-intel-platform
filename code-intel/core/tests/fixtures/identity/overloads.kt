package demo
class LoginService(name: String) {
  constructor(id: Int): this(id.toString())
  fun login(token: String) {}
  fun login(id: Int) {}
}
