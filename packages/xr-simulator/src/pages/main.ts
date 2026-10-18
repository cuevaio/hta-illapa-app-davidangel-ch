import './base.css';
import './app.css';
import { App } from '../app/App';

const root = document.getElementById('app')!;
const loading = document.createElement('div');
loading.className = 'loading';
loading.textContent = 'Preparando simulador…';
root.append(loading);

new App(root)
  .start()
  .then(() => loading.remove())
  .catch((err) => {
    console.error(err);
    loading.remove();
    const box = document.createElement('section');
    box.className = 'notice notice-error app-error';
    box.innerHTML = '<h2>No se pudo iniciar el simulador</h2><p class="msg"></p><p><a href="./diagnostics.html">Abrir el diagnóstico</a></p>';
    box.querySelector('.msg')!.textContent = String(err);
    root.append(box);
  });
