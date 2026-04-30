using System;
using System.Collections.Generic;

namespace Example.Services
{
    /// <summary>
    /// Service for managing users.
    /// </summary>
    public class UserService
    {
        private readonly string _name;

        public UserService(string name)
        {
            _name = name;
        }

        public string GetUser(int id)
        {
            return _name;
        }

        public void SaveUser(string user)
        {
            // implementation
        }

        private string FormatName(string input)
        {
            return input.Trim();
        }
    }

    public interface IUserRepository
    {
        IEnumerable<string> FindAll();
        string FindById(int id);
    }

    public enum UserRole
    {
        Admin,
        User,
        Guest
    }

    public struct Point
    {
        public int X;
        public int Y;
    }
}
