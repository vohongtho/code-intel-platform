namespace Demo;
public partial class LoginService { public LoginService(string name) {} public void Login(string token) {} }
public partial class LoginService { public LoginService(int id) {} public void Login(int id) {} }
internal class HiddenService { private void Login(string token) {} }
