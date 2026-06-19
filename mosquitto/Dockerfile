FROM eclipse-mosquitto:latest
COPY config/mosquitto.conf /mosquitto/config/mosquitto.conf
RUN mosquitto_passwd -b -c /mosquitto/config/passwd cow cow@1234
