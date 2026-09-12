-- Precio fijo opcional por tamaño de tanque (si no se define, se sigue calculando
-- proporcional al ml del líquido, como hasta ahora).
ALTER TABLE "perfiles_dispositivo" ADD COLUMN     "precio" DECIMAL(12,2);
