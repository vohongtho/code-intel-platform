use std::collections::HashMap;

pub struct User {
    pub id: u32,
    pub name: String,
    pub email: String,
}

pub struct UserRepository {
    users: HashMap<u32, User>,
    next_id: u32,
}

impl UserRepository {
    pub fn new() -> Self {
        UserRepository { users: HashMap::new(), next_id: 1 }
    }

    pub fn create(&mut self, name: String, email: String) -> &User {
        let id = self.next_id;
        self.users.insert(id, User { id, name, email });
        self.next_id += 1;
        self.users.get(&id).unwrap()
    }

    pub fn find_by_id(&self, id: u32) -> Option<&User> {
        self.users.get(&id)
    }

    pub fn delete(&mut self, id: u32) -> bool {
        self.users.remove(&id).is_some()
    }

    pub fn count(&self) -> usize {
        self.users.len()
    }
}

pub fn validate_email(email: &str) -> bool {
    email.contains('@') && email.contains('.')
}

pub fn format_user(user: &User) -> String {
    format!("{} <{}>", user.name, user.email)
}

fn internal_hash(s: &str) -> u64 {
    s.bytes().fold(0u64, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u64))
}

pub fn generate_token(email: &str) -> String {
    format!("tok_{}", internal_hash(email))
}
