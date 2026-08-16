# Clasificador de finiquitos

Aplicación web para clasificar resoluciones judiciales en formato PDF como finiquito o no finiquito. Su finalidad es apoyar la revisión inicial de documentos mediante un modelo de regresión logística entrenado previamente.

La aplicación utiliza el texto posterior a la última aparición de `RESUELVE` y presenta la clasificación, la probabilidad, la confianza y los términos con mayor contribución. Los resultados pueden exportarse a Excel.

Los PDF se procesan en el navegador. El servidor solo entrega los archivos estáticos de la aplicación.
