<?php
class UserService { public function getUser(int $id) {} public function saveUser($user) {} private function formatName(string $input) {} }
interface UserRepository { public function findAll(): array; }
trait Loggable { public function log(string $message): void {} }
