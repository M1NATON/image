# 🔒 Безопасность VPS

Пошаговое руководство по защите вашего VPS сервера.

## ⚡ Быстрый чеклист (минимум)

Выполните это сразу после получения VPS:

```bash
# 1. Обновление системы
sudo apt update && sudo apt upgrade -y

# 2. Создание нового пользователя
sudo adduser botuser
sudo usermod -aG sudo botuser

# 3. Настройка firewall
sudo ufw allow 22/tcp
sudo ufw enable

# 4. Отключение root SSH
sudo nano /etc/ssh/sshd_config
# Измените: PermitRootLogin no
sudo systemctl restart sshd
```

---

## 🛡️ Полная настройка безопасности

### 1. Обновление системы

```bash
# Обновить пакеты
sudo apt update && sudo apt upgrade -y

# Автоматические обновления безопасности
sudo apt install unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

---

### 2. Создание нового пользователя (НЕ root)

**Никогда не работайте под root!**

```bash
# Создать пользователя
sudo adduser botuser

# Добавить в sudo группу
sudo usermod -aG sudo botuser

# Переключиться на нового пользователя
su - botuser

# Проверка sudo
sudo whoami  # должно вывести: root
```

**Теперь работайте только под этим пользователем!**

---

### 3. Настройка SSH ключей (вместо паролей)

**На вашем Windows:**

Создайте SSH ключ (если нет):
```powershell
# В PowerShell
ssh-keygen -t ed25519 -C "your_email@example.com"
# Нажмите Enter 3 раза (сохранить в ~/.ssh/id_ed25519)

# Скопируйте публичный ключ на VPS
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh botuser@your-vps-ip "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

**На VPS:**

```bash
# Установить правильные права
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys

# Теперь можете входить без пароля:
# ssh botuser@your-vps-ip
```

---

### 4. Защита SSH

```bash
# Редактировать конфиг SSH
sudo nano /etc/ssh/sshd_config
```

Измените следующие параметры:

```conf
# Отключить вход под root
PermitRootLogin no

# Отключить вход по паролю (только SSH ключи)
PasswordAuthentication no
PubkeyAuthentication yes

# Отключить пустые пароли
PermitEmptyPasswords no

# Изменить порт SSH (опционально, усложняет автоматические атаки)
Port 2222  # Вместо 22

# Ограничить попытки входа
MaxAuthTries 3

# Отключить X11 forwarding
X11Forwarding no

# Разрешить вход только определенным пользователям
AllowUsers botuser
```

Сохраните и перезапустите SSH:

```bash
sudo systemctl restart sshd

# ВАЖНО: НЕ закрывайте текущую сессию!
# Откройте новое окно и проверьте, что можете войти:
# ssh botuser@your-vps-ip -p 2222
```

---

### 5. Настройка Firewall (UFW)

```bash
# Установка (если нет)
sudo apt install ufw

# Запретить всё по умолчанию
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Разрешить SSH (если изменили порт на 2222)
sudo ufw allow 2222/tcp

# Или стандартный порт 22
sudo ufw allow 22/tcp

# Разрешить health check (только если нужен внешний доступ)
sudo ufw allow 3000/tcp

# Включить firewall
sudo ufw enable

# Проверка
sudo ufw status verbose
```

**Результат должен быть:**
```
Status: active

To                         Action      From
--                         ------      ----
2222/tcp                   ALLOW       Anywhere
3000/tcp                   ALLOW       Anywhere
```

---

### 6. Установка Fail2Ban (защита от брутфорса)

```bash
# Установка
sudo apt install fail2ban

# Создать конфиг
sudo nano /etc/fail2ban/jail.local
```

Вставьте:

```conf
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5
destemail = your-email@example.com
sendername = Fail2Ban

[sshd]
enabled = true
port = 2222
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 24h
```

Запустите:

```bash
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# Проверка
sudo fail2ban-client status
sudo fail2ban-client status sshd
```

---

### 7. Отключение ненужных сервисов

```bash
# Посмотреть запущенные сервисы
sudo systemctl list-units --type=service --state=running

# Отключить ненужные (примеры):
sudo systemctl disable bluetooth.service
sudo systemctl stop bluetooth.service
```

---

### 8. Настройка логирования

```bash
# Установка logwatch (отчеты по email)
sudo apt install logwatch

# Отправка ежедневных отчетов
sudo logwatch --output mail --mailto your-email@example.com --detail high
```

---

### 9. Защита от DDoS (Cloudflare/Nginx)

Если у вас веб-интерфейс (health check):

```bash
# Установка Nginx как reverse proxy
sudo apt install nginx

# Конфиг
sudo nano /etc/nginx/sites-available/bot-health
```

```nginx
limit_req_zone $binary_remote_addr zone=health:10m rate=10r/s;

server {
    listen 80;
    server_name your-domain.com;

    location /health {
        limit_req zone=health burst=20 nodelay;
        proxy_pass http://localhost:3000;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/bot-health /etc/nginx/sites-enabled/
sudo systemctl restart nginx
```

---

### 10. Регулярные бэкапы

```bash
# Создать скрипт бэкапа
nano ~/backup.sh
```

```bash
#!/bin/bash
BACKUP_DIR=~/backups
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Бэкап проекта
tar -czf $BACKUP_DIR/bot_$DATE.tar.gz ~/telegram-image-bot

# Бэкап логов
tar -czf $BACKUP_DIR/logs_$DATE.tar.gz ~/telegram-image-bot/logs

# Удалить старые бэкапы (старше 7 дней)
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete

echo "Backup completed: $DATE"
```

```bash
chmod +x ~/backup.sh

# Добавить в cron (ежедневно в 3:00)
crontab -e
```

Добавьте строку:
```
0 3 * * * ~/backup.sh >> ~/backup.log 2>&1
```

---

### 11. Мониторинг ресурсов

```bash
# Установка htop
sudo apt install htop

# Установка netdata (мониторинг в браузере)
bash <(curl -Ss https://my-netdata.io/kickstart.sh)

# Доступ: http://your-vps-ip:19999
```

---

### 12. Защита Docker (если используете)

```bash
# НЕ запускать Docker от root
sudo usermod -aG docker botuser

# Ограничить ресурсы контейнеров
# В docker-compose.yml добавьте:
```

```yaml
services:
  telegram-bot:
    # ...
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 1G
```

---

## 🔍 Регулярные проверки безопасности

### Еженедельно:

```bash
# Обновления
sudo apt update && sudo apt upgrade -y

# Проверка логов
sudo tail -100 /var/log/auth.log
sudo fail2ban-client status sshd

# Проверка открытых портов
sudo netstat -tulpn | grep LISTEN
```

### Ежемесячно:

```bash
# Аудит безопасности
sudo apt install lynis
sudo lynis audit system

# Проверка неиспользуемых пакетов
sudo apt autoremove
```

---

## 🚨 Что делать при взломе

1. **Немедленно отключите сервер от сети:**
   ```bash
   sudo shutdown -h now
   ```

2. **Свяжитесь с провайдером VPS**

3. **Создайте новый VPS и мигрируйте**

4. **Измените все пароли и ключи**

---

## ✅ Финальный чеклист безопасности

- [ ] Система обновлена
- [ ] Создан отдельный пользователь (не root)
- [ ] SSH ключи настроены
- [ ] Root SSH отключен
- [ ] Вход по паролю отключен
- [ ] Firewall (UFW) включен и настроен
- [ ] Fail2Ban установлен и работает
- [ ] Ненужные сервисы отключены
- [ ] Бэкапы настроены
- [ ] Логи мониторятся
- [ ] Порты закрыты (кроме нужных)

---

## 📊 Проверка уровня безопасности

Запустите аудит:

```bash
# Установка lynis
sudo apt install lynis

# Проверка
sudo lynis audit system

# Результат покажет уровень безопасности (0-100)
# Целевой уровень: 85+
```

---

## 🔗 Полезные ссылки

- [Ubuntu Security Guide](https://ubuntu.com/security)
- [Fail2Ban Documentation](https://www.fail2ban.org/)
- [SSH Hardening Guide](https://www.ssh.com/academy/ssh/sshd_config)

---

**Следуя этому руководству, ваш VPS будет защищен от 99% атак!** 🛡️
