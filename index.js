/**
 * ==============================================================================
 * TASKFLOW PRO - CORE ENTERPRISE JAVASCRIPT APPLICATION ARCHITECTURE
 * ==============================================================================
 * 
 * MODULE STRUCTURE:
 * 1.  Utils & Helpers
 * 2.  EventBus Architecture
 * 3.  StateStore System (State Management with History & Persistence)
 * 4.  Mock REST API & Data Seeding Service
 * 5.  Form Validator Engine
 * 6.  Toast Notification Engine
 * 7.  Modal & Dialog Engine
 * 8.  HTML5 Canvas Data Visualization Engine (2D Render pipeline)
 * 9.  Kanban Drag-and-Drop Controller
 * 10. Data Grid & Table Engine (Sorting, Search, Pagination)
 * 11. Time Tracker Stopwatch & Log Manager
 * 12. Data Import/Export Engine (CSV, JSON)
 * 13. Shortcut & Hotkey Manager
 * 14. Command Palette System
 * 15. Theme & Style Engine
 * 16. SPA View Router & Navigation
 * 17. Core Application Controller & Bootstrapper
 * 
 * ==============================================================================
 */

"use strict";

/* ==============================================================================
 * 1. UTILS & HELPERS MODULE
 * ============================================================================== */
class Utils {
    /**
     * Generates a unique UUID v4 compliant string.
     * @returns {string} Unique identifier
     */
    static generateUUID() {
        return 'ax-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Formats a date object or string into YYYY-MM-DD format.
     * @param {Date|string} dateInput 
     * @returns {string} Formatted date string
     */
    static formatDate(dateInput) {
        if (!dateInput) return '';
        const d = new Date(dateInput);
        if (isNaN(d.getTime())) return '';
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * Converts seconds into HH:MM:SS format.
     * @param {number} seconds 
     * @returns {string} Formatted time string
     */
    static formatDuration(seconds) {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return [hrs, mins, secs]
            .map(v => String(v).padStart(2, '0'))
            .join(':');
    }

    /**
     * Debounces a function execution.
     * @param {Function} func 
     * @param {number} wait 
     * @returns {Function}
     */
    static debounce(func, wait = 300) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Sanitizes string to prevent HTML injection.
     * @param {string} str 
     * @returns {string}
     */
    static escapeHTML(str) {
        if (typeof str !== 'string') return str;
        return str.replace(/[&<>'"]/g, 
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag] || tag)
        );
    }

    /**
     * Deep clone utility for state immutability.
     * @param {Object} obj 
     * @returns {Object}
     */
    static deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }
}

/* ==============================================================================
 * 2. EVENT BUS ARCHITECTURE
 * ============================================================================== */
class EventBus {
    constructor() {
        this.events = {};
    }

    /**
     * Subscribe to an event
     * @param {string} event 
     * @param {Function} callback 
     */
    on(event, callback) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(callback);
    }

    /**
     * Unsubscribe from an event
     * @param {string} event 
     * @param {Function} callback 
     */
    off(event, callback) {
        if (!this.events[event]) return;
        this.events[event] = this.events[event].filter(cb => cb !== callback);
    }

    /**
     * Emit event with data payload
     * @param {string} event 
     * @param {Object} data 
     */
    emit(event, data) {
        if (!this.events[event]) return;
        this.events[event].forEach(callback => {
            try {
                callback(data);
            } catch (err) {
                console.error(`Error in EventBus listener for event "${event}":`, err);
            }
        });
    }
}

const globalEventBus = new EventBus();

/* ==============================================================================
 * 3. STATE STORE SYSTEM (OBSERVER PATTERN & LOCALSTORAGE SYNC)
 * ============================================================================== */
class StateStore {
    constructor(initialState = {}) {
        this.state = initialState;
        this.listeners = [];
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistory = 20;
    }

    /**
     * Get current snapshot of state
     * @returns {Object}
     */
    getState() {
        return Utils.deepClone(this.state);
    }

    /**
     * Mutate state and notify observers
     * @param {Object} newState Partial or full state updates
     * @param {boolean} recordHistory Whether to save snapshot in undo stack
     */
    setState(newState, recordHistory = true) {
        if (recordHistory) {
            this.undoStack.push(Utils.deepClone(this.state));
            if (this.undoStack.length > this.maxHistory) {
                this.undoStack.shift();
            }
            this.redoStack = []; // Clear redo on new action
        }

        this.state = { ...this.state, ...newState };
        this.notify();
        this.saveToStorage();
    }

    /**
     * Subscribe to state updates
     * @param {Function} listener 
     */
    subscribe(listener) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    /**
     * Notify all subscribers
     */
    notify() {
        this.listeners.forEach(listener => listener(this.getState()));
    }

    /**
     * Revert state to previous history frame
     */
    undo() {
        if (this.undoStack.length === 0) return false;
        this.redoStack.push(Utils.deepClone(this.state));
        this.state = this.undoStack.pop();
        this.notify();
        this.saveToStorage();
        return true;
    }

    /**
     * Advance state to next redo history frame
     */
    redo() {
        if (this.redoStack.length === 0) return false;
        this.undoStack.push(Utils.deepClone(this.state));
        this.state = this.redoStack.pop();
        this.notify();
        this.saveToStorage();
        return true;
    }

    /**
     * Save current state to LocalStorage
     */
    saveToStorage() {
        try {
            localStorage.setItem('taskflow_pro_state', JSON.stringify(this.state));
        } catch (e) {
            console.error('Could not save state to LocalStorage:', e);
        }
    }

    /**
     * Load state from LocalStorage
     */
    loadFromStorage() {
        try {
            const stored = localStorage.getItem('taskflow_pro_state');
            if (stored) {
                this.state = JSON.parse(stored);
                this.notify();
                return true;
            }
        } catch (e) {
            console.error('Could not load state from LocalStorage:', e);
        }
        return false;
    }
}

/* ==============================================================================
 * 4. MOCK REST API & DATA SEEDING SERVICE
 * ============================================================================== */
class MockApiService {
    static getInitialSeedData() {
        return {
            tasks: [
                { id: 'TSK-101', title: 'Déployer le serveur de staging v2', priority: 'Haute', status: 'in-progress', dueDate: '2026-10-20', createdAt: '2026-10-01' },
                { id: 'TSK-102', title: 'Optimiser les requêtes SQL de la base client', priority: 'Moyenne', status: 'todo', dueDate: '2026-10-25', createdAt: '2026-10-02' },
                { id: 'TSK-103', title: 'Rédiger la documentation de l\'API REST', priority: 'Basse', status: 'done', dueDate: '2026-10-10', createdAt: '2026-09-28' },
                { id: 'TSK-104', title: 'Correction des vulnérabilités OWASP', priority: 'Haute', status: 'review', dueDate: '2026-10-18', createdAt: '2026-10-05' },
                { id: 'TSK-105', title: 'Mise en place des tests d\'intégration', priority: 'Moyenne', status: 'todo', dueDate: '2026-10-30', createdAt: '2026-10-08' }
            ],
            timeLogs: [
                { id: 'LOG-01', taskId: 'TSK-101', taskTitle: 'Déployer le serveur de staging v2', durationSeconds: 5400, date: '2026-10-11' },
                { id: 'LOG-02', taskId: 'TSK-103', taskTitle: 'Rédiger la documentation de l\'API REST', durationSeconds: 3600, date: '2026-10-10' }
            ],
            settings: {
                username: 'Alexandre Dev',
                pageSize: 5,
                theme: 'dark'
            },
            recentActivity: [
                'Tâche TSK-104 passée en Révision',
                'Tâche TSK-103 marquée comme Terminée',
                'Nouveau log de temps ajouté (1h30m)'
            ]
        };
    }
}

/* ==============================================================================
 * 5. FORM VALIDATOR ENGINE
 * ============================================================================== */
class FormValidator {
    constructor(formElement) {
        this.form = formElement;
        this.errors = {};
    }

    /**
     * Clear existing error displays
     */
    clearErrors() {
        this.errors = {};
        const errorNodes = this.form.querySelectorAll('.form-error-msg');
        errorNodes.forEach(node => node.remove());
        const invalidInputs = this.form.querySelectorAll('.input-invalid');
        invalidInputs.forEach(input => input.classList.remove('input-invalid'));
    }

    /**
     * Validate rules for the task form
     * @returns {boolean}
     */
    validateTaskForm() {
        this.clearErrors();
        let isValid = true;

        const titleInput = this.form.querySelector('#task-title');
        if (!titleInput || titleInput.value.trim().length < 3) {
            this.showError(titleInput, 'Le titre doit contenir au moins 3 caractères.');
            isValid = false;
        }

        const dueDateInput = this.form.querySelector('#task-due-date');
        if (!dueDateInput || !dueDateInput.value) {
            this.showError(dueDateInput, 'Veuillez sélectionner une date d\'échéance valide.');
            isValid = false;
        }

        return isValid;
    }

    /**
     * Attach an inline error message under input
     * @param {HTMLElement} element 
     * @param {string} message 
     */
    showError(element, message) {
        if (!element) return;
        element.classList.add('input-invalid');
        const errSpan = document.createElement('span');
        errSpan.className = 'form-error-msg';
        errSpan.style.color = 'var(--danger)';
        errSpan.style.fontSize = '0.75rem';
        errSpan.style.marginTop = '0.25rem';
        errSpan.style.display = 'block';
        errSpan.innerText = message;
        element.parentNode.appendChild(errSpan);
    }
}

/* ==============================================================================
 * 6. TOAST NOTIFICATION ENGINE
 * ============================================================================== */
class ToastManager {
    constructor(containerId = 'toast-container') {
        this.container = document.getElementById(containerId);
    }

    /**
     * Display a floating notification
     * @param {string} message 
     * @param {string} type 'success' | 'error' | 'info'
     * @param {number} duration 
     */
    show(message, type = 'info', duration = 3000) {
        if (!this.container) return;
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerText = message;

        this.container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
}

const toastEngine = new ToastManager();

/* ==============================================================================
 * 7. MODAL & DIALOG ENGINE
 * ============================================================================== */
class ModalManager {
    constructor(modalOverlayId = 'app-modal') {
        this.overlay = document.getElementById(modalOverlayId);
        this.closeBtn = document.getElementById('btn-close-modal');
        this.form = document.getElementById('modal-task-form');
        this.initListeners();
    }

    initListeners() {
        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => this.close());
        }
        if (this.overlay) {
            this.overlay.addEventListener('click', (e) => {
                if (e.target === this.overlay) this.close();
            });
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen()) {
                this.close();
            }
        });
    }

    isOpen() {
        return this.overlay && this.overlay.style.display === 'flex';
    }

    open(title = 'Créer une Tâche', taskData = null) {
        if (!this.overlay) return;
        document.getElementById('modal-title').innerText = title;
        
        // Reset or populate fields
        document.getElementById('task-id').value = taskData ? taskData.id : '';
        document.getElementById('task-title').value = taskData ? taskData.title : '';
        document.getElementById('task-priority').value = taskData ? taskData.priority : 'Moyenne';
        document.getElementById('task-status').value = taskData ? taskData.status : 'todo';
        document.getElementById('task-due-date').value = taskData ? taskData.dueDate : Utils.formatDate(new Date());

        this.overlay.style.display = 'flex';
    }

    close() {
        if (!this.overlay) return;
        this.overlay.style.display = 'none';
        if (this.form) this.form.reset();
    }
}

/* ==============================================================================
 * 8. HTML5 CANVAS DATA VISUALIZATION ENGINE (2D RENDER PIPELINE)
 * ============================================================================== */
class CanvasChartEngine {
    /**
     * Renders a Progress Line/Bar Chart on Canvas
     * @param {string} canvasId 
     * @param {Array} labels 
     * @param {Array} values 
     */
    static renderBarChart(canvasId, labels, values) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        
        // Adjust display DPI
        const width = canvas.width = canvas.parentElement.clientWidth || 300;
        const height = canvas.height = 200;

        ctx.clearRect(0, 0, width, height);

        const padding = 40;
        const chartWidth = width - (padding * 2);
        const chartHeight = height - (padding * 2);
        const maxValue = Math.max(...values, 10);
        const barWidth = (chartWidth / values.length) - 15;

        // Draw Axes
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding, padding);
        ctx.lineTo(padding, height - padding);
        ctx.lineTo(width - padding, height - padding);
        ctx.stroke();

        // Draw Bars
        values.forEach((val, i) => {
            const barHeight = (val / maxValue) * chartHeight;
            const x = padding + (i * (barWidth + 15)) + 10;
            const y = height - padding - barHeight;

            ctx.fillStyle = '#3b82f6';
            ctx.fillRect(x, y, barWidth, barHeight);

            // Draw Labels
            ctx.fillStyle = '#94a3b8';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(labels[i] || '', x + (barWidth / 2), height - padding + 15);
            ctx.fillText(val.toString(), x + (barWidth / 2), y - 5);
        });
    }

    /**
     * Renders a Pie Chart on Canvas
     * @param {string} canvasId 
     * @param {Array} data [{ label, value, color }]
     */
    static renderPieChart(canvasId, data) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        const width = canvas.width = canvas.parentElement.clientWidth || 300;
        const height = canvas.height = 200;
        ctx.clearRect(0, 0, width, height);

        const total = data.reduce((acc, curr) => acc + curr.value, 0);
        if (total === 0) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Aucune donnée disponible', width / 2, height / 2);
            return;
        }

        let startAngle = 0;
        const centerX = width / 3;
        const centerY = height / 2;
        const radius = Math.min(centerX, centerY) - 20;

        data.forEach(slice => {
            const sliceAngle = (slice.value / total) * 2 * Math.PI;

            ctx.beginPath();
            ctx.fillStyle = slice.color;
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
            ctx.closePath();
            ctx.fill();

            startAngle += sliceAngle;
        });

        // Legend Rendering
        const legendX = (width / 2) + 30;
        let legendY = 40;

        data.forEach(slice => {
            ctx.fillStyle = slice.color;
            ctx.fillRect(legendX, legendY, 12, 12);

            ctx.fillStyle = '#94a3b8';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(`${slice.label} (${slice.value})`, legendX + 20, legendY + 10);

            legendY += 25;
        });
    }
}

/* ==============================================================================
 * 9. KANBAN DRAG-AND-DROP CONTROLLER
 * ============================================================================== */
class KanbanController {
    constructor(store) {
        this.store = store;
        this.draggedTaskId = null;
    }

    init() {
        this.bindEvents();
    }

    bindEvents() {
        document.addEventListener('dragstart', (e) => {
            if (e.target.classList.contains('kanban-card')) {
                this.draggedTaskId = e.target.dataset.id;
                e.target.style.opacity = '0.4';
            }
        });

        document.addEventListener('dragend', (e) => {
            if (e.target.classList.contains('kanban-card')) {
                e.target.style.opacity = '1';
                this.draggedTaskId = null;
            }
        });

        const columns = document.querySelectorAll('.kanban-column');
        columns.forEach(col => {
            col.addEventListener('dragover', (e) => e.preventDefault());
            col.addEventListener('drop', (e) => {
                e.preventDefault();
                const newStatus = col.dataset.status;
                if (this.draggedTaskId && newStatus) {
                    this.updateTaskStatus(this.draggedTaskId, newStatus);
                }
            });
        });
    }

    updateTaskStatus(taskId, newStatus) {
        const state = this.store.getState();
        const updatedTasks = state.tasks.map(t => {
            if (t.id === taskId) {
                return { ...t, status: newStatus };
            }
            return t;
        });

        const activityMsg = `Tâche ${taskId} déplacée vers ${newStatus.toUpperCase()}`;
        const updatedActivity = [activityMsg, ...state.recentActivity].slice(0, 5);

        this.store.setState({ tasks: updatedTasks, recentActivity: updatedActivity });
        toastEngine.show(`Statut mis à jour: ${newStatus}`, 'info');
    }

    render(tasks) {
        const statuses = ['todo', 'in-progress', 'review', 'done'];
        
        statuses.forEach(status => {
            const container = document.getElementById(`cards-${status}`);
            const countBadge = document.getElementById(`count-${status}`);
            if (!container) return;

            const filteredTasks = tasks.filter(t => t.status === status);
            if (countBadge) countBadge.innerText = filteredTasks.length.toString();

            container.innerHTML = filteredTasks.map(task => `
                <div class="kanban-card" draggable="true" data-id="${task.id}">
                    <div style="font-size: 0.75rem; color: var(--text-secondary); display: flex; justify-content: space-between;">
                        <span>${task.id}</span>
                        <span style="color: ${this.getPriorityColor(task.priority)}">${task.priority}</span>
                    </div>
                    <div style="font-weight: 600; margin: 0.5rem 0;">${Utils.escapeHTML(task.title)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary);">Échéance: ${task.dueDate}</div>
                    <div style="margin-top: 0.5rem; display: flex; gap: 0.5rem;">
                        <button class="btn btn-secondary btn-edit-task" data-id="${task.id}" style="padding: 0.2rem 0.4rem; font-size: 0.7rem;">Éditer</button>
                        <button class="btn btn-danger btn-delete-task" data-id="${task.id}" style="padding: 0.2rem 0.4rem; font-size: 0.7rem;">Supprimer</button>
                    </div>
                </div>
            `).join('');
        });
    }

    getPriorityColor(priority) {
        switch (priority) {
            case 'Haute': return 'var(--danger)';
            case 'Moyenne': return 'var(--warning)';
            default: return 'var(--success)';
        }
    }
}

/* ==============================================================================
 * 10. DATA GRID & TABLE ENGINE
 * ============================================================================== */
class DataTableEngine {
    constructor(store) {
        this.store = store;
        this.currentPage = 1;
        this.sortKey = 'id';
        this.sortAsc = true;
        this.filterQuery = '';
    }

    init() {
        this.bindEvents();
    }

    bindEvents() {
        const filterInput = document.getElementById('table-filter-input');
        if (filterInput) {
            filterInput.addEventListener('input', Utils.debounce((e) => {
                this.filterQuery = e.target.value.toLowerCase();
                this.currentPage = 1;
                this.render();
            }, 250));
        }

        const prevBtn = document.getElementById('btn-prev-page');
        const nextBtn = document.getElementById('btn-next-page');

        if (prevBtn) prevBtn.addEventListener('click', () => {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.render();
            }
        });

        if (nextBtn) nextBtn.addEventListener('click', () => {
            const totalPages = this.getTotalPages();
            if (this.currentPage < totalPages) {
                this.currentPage++;
                this.render();
            }
        });

        const headers = document.querySelectorAll('#tasks-table th[data-sort]');
        headers.forEach(header => {
            header.addEventListener('click', () => {
                const key = header.dataset.sort;
                if (this.sortKey === key) {
                    this.sortAsc = !this.sortAsc;
                } else {
                    this.sortKey = key;
                    this.sortAsc = true;
                }
                this.render();
            });
        });
    }

    getFilteredTasks() {
        const { tasks } = this.store.getState();
        return tasks.filter(t => 
            t.title.toLowerCase().includes(this.filterQuery) ||
            t.id.toLowerCase().includes(this.filterQuery) ||
            t.priority.toLowerCase().includes(this.filterQuery) ||
            t.status.toLowerCase().includes(this.filterQuery)
        );
    }

    getSortedTasks(tasks) {
        return [...tasks].sort((a, b) => {
            let valA = a[this.sortKey] || '';
            let valB = b[this.sortKey] || '';

            if (valA < valB) return this.sortAsc ? -1 : 1;
            if (valA > valB) return this.sortAsc ? 1 : -1;
            return 0;
        });
    }

    getTotalPages() {
        const filtered = this.getFilteredTasks();
        const pageSize = this.store.getState().settings.pageSize || 5;
        return Math.ceil(filtered.length / pageSize) || 1;
    }

    render() {
        const tbody = document.getElementById('tasks-table-body');
        const pageInfo = document.getElementById('table-page-info');
        if (!tbody) return;

        const filtered = this.getFilteredTasks();
        const sorted = this.getSortedTasks(filtered);
        const pageSize = this.store.getState().settings.pageSize || 5;

        const startIndex = (this.currentPage - 1) * pageSize;
        const paginated = sorted.slice(startIndex, startIndex + pageSize);

        tbody.innerHTML = paginated.map(task => `
            <tr>
                <td><strong>${task.id}</strong></td>
                <td>${Utils.escapeHTML(task.title)}</td>
                <td><span style="color:${this.getPriorityColor(task.priority)}">${task.priority}</span></td>
                <td><span class="badge">${task.status}</span></td>
                <td>${task.dueDate}</td>
                <td>
                    <button class="btn btn-secondary btn-edit-task" data-id="${task.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">Éditer</button>
                    <button class="btn btn-danger btn-delete-task" data-id="${task.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">Supprimer</button>
                </td>
            </tr>
        `).join('');

        if (pageInfo) {
            pageInfo.innerText = `Page ${this.currentPage} sur ${this.getTotalPages()}`;
        }
    }

    getPriorityColor(priority) {
        switch (priority) {
            case 'Haute': return 'var(--danger)';
            case 'Moyenne': return 'var(--warning)';
            default: return 'var(--success)';
        }
    }
}

/* ==============================================================================
 * 11. TIME TRACKER STOPWATCH & LOG MANAGER
 * ============================================================================== */
class TimeTrackerEngine {
    constructor(store) {
        this.store = store;
        this.timerInterval = null;
        this.elapsedSeconds = 0;
        this.isRunning = false;
        this.selectedTaskId = null;
    }

    init() {
        this.bindEvents();
    }

    bindEvents() {
        const btnStart = document.getElementById('btn-timer-start');
        const btnPause = document.getElementById('btn-timer-pause');
        const btnStop = document.getElementById('btn-timer-stop');
        const taskSelect = document.getElementById('timer-task-select');

        if (btnStart) btnStart.addEventListener('click', () => this.start());
        if (btnPause) btnPause.addEventListener('click', () => this.pause());
        if (btnStop) btnStop.addEventListener('click', () => this.stopAndSave());

        if (taskSelect) {
            taskSelect.addEventListener('change', (e) => {
                this.selectedTaskId = e.target.value;
            });
        }
    }

    updateSelectOptions(tasks) {
        const taskSelect = document.getElementById('timer-task-select');
        if (!taskSelect) return;

        const currentVal = taskSelect.value;
        taskSelect.innerHTML = '<option value="">Sélectionner une tâche...</option>' +
            tasks.map(t => `<option value="${t.id}">${t.id} - ${Utils.escapeHTML(t.title)}</option>`).join('');
        
        taskSelect.value = currentVal;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        toastEngine.show('Minuteur démarré', 'info');

        this.timerInterval = setInterval(() => {
            this.elapsedSeconds++;
            this.updateDisplay();
        }, 1000);
    }

    pause() {
        if (!this.isRunning) return;
        this.isRunning = false;
        clearInterval(this.timerInterval);
        toastEngine.show('Minuteur en pause', 'info');
    }

    stopAndSave() {
        if (this.elapsedSeconds === 0) {
            toastEngine.show('Aucun temps enregistré à sauvegarder.', 'error');
            return;
        }

        this.pause();

        const state = this.store.getState();
        const task = state.tasks.find(t => t.id === this.selectedTaskId);
        const taskTitle = task ? task.title : 'Tâche générale';

        const newLog = {
            id: 'LOG-' + Date.now().toString().slice(-4),
            taskId: this.selectedTaskId || 'N/A',
            taskTitle: taskTitle,
            durationSeconds: this.elapsedSeconds,
            date: Utils.formatDate(new Date())
        };

        const updatedLogs = [newLog, ...state.timeLogs];
        this.store.setState({ timeLogs: updatedLogs });

        this.elapsedSeconds = 0;
        this.updateDisplay();
        toastEngine.show('Session de temps enregistrée avec succès!', 'success');
    }

    updateDisplay() {
        const display = document.getElementById('main-timer');
        if (display) {
            display.innerText = Utils.formatDuration(this.elapsedSeconds);
        }
    }

    renderLogs(timeLogs) {
        const logsList = document.getElementById('time-logs-list');
        if (!logsList) return;

        logsList.innerHTML = timeLogs.map(log => `
            <li style="padding: 0.75rem; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong>${log.taskTitle}</strong>
                    <div style="font-size: 0.75rem; color: var(--text-secondary);">${log.date}</div>
                </div>
                <div style="font-family: monospace; font-size: 1.1rem; color: var(--accent);">
                    ${Utils.formatDuration(log.durationSeconds)}
                </div>
            </li>
        `).join('');
    }
}

/* ==============================================================================
 * 12. DATA IMPORT/EXPORT ENGINE
 * ============================================================================== */
class ExportImportEngine {
    /**
     * Convert array of task objects to CSV format and download
     * @param {Array} tasks 
     */
    static exportTasksToCSV(tasks) {
        if (!tasks || !tasks.length) {
            toastEngine.show('Aucune donnée à exporter.', 'error');
            return;
        }

        const headers = ['ID', 'Titre', 'Priorite', 'Statut', 'Echeance', 'Date Creation'];
        const csvRows = [headers.join(',')];

        tasks.forEach(task => {
            const row = [
                `"${task.id}"`,
                `"${task.title.replace(/"/g, '""')}"`,
                `"${task.priority}"`,
                `"${task.status}"`,
                `"${task.dueDate}"`,
                `"${task.createdAt || ''}"`
            ];
            csvRows.push(row.join(','));
        });

        const csvContent = 'data:text/csv;charset=utf-8,' + csvRows.join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `export_tasks_${Utils.formatDate(new Date())}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toastEngine.show('Export CSV téléchargé!', 'success');
    }
}

/* ==============================================================================
 * 13. SHORTCUT & HOTKEY MANAGER
 * ============================================================================== */
class ShortcutManager {
    constructor(store, modalManager) {
        this.store = store;
        this.modalManager = modalManager;
    }

    init() {
        document.addEventListener('keydown', (e) => {
            // Ctrl + K: Focus Global Search
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                const searchInput = document.getElementById('global-search');
                if (searchInput) searchInput.focus();
            }

            // Ctrl + N: Open Quick New Task Modal
            if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
                e.preventDefault();
                this.modalManager.open('Créer une Tâche');
            }

            // Ctrl + Z: Undo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                if (this.store.undo()) {
                    toastEngine.show('Action annulée (Undo)', 'info');
                }
            }

            // Ctrl + Shift + Z or Ctrl + Y: Redo
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                e.preventDefault();
                if (this.store.redo()) {
                    toastEngine.show('Action rétablie (Redo)', 'info');
                }
            }
        });
    }
}

/* ==============================================================================
 * 14. COMMAND PALETTE SYSTEM
 * ============================================================================== */
class CommandPalette {
    constructor(store) {
        this.store = store;
    }

    init() {
        const searchInput = document.getElementById('global-search');
        if (searchInput) {
            searchInput.addEventListener('input', Utils.debounce((e) => {
                const query = e.target.value.toLowerCase().trim();
                if (query.length > 2) {
                    this.executeSearch(query);
                }
            }, 300));
        }
    }

    executeSearch(query) {
        const { tasks } = this.store.getState();
        const matches = tasks.filter(t => t.title.toLowerCase().includes(query) || t.id.toLowerCase().includes(query));
        
        if (matches.length > 0) {
            toastEngine.show(`${matches.length} résultat(s) trouvé(s) pour "${query}"`, 'info');
        } else {
            toastEngine.show(`Aucun résultat pour "${query}"`, 'error');
        }
    }
}

/* ==============================================================================
 * 15. THEME & STYLE ENGINE
 * ============================================================================== */
class ThemeManager {
    constructor(store) {
        this.store = store;
    }

    init() {
        const toggleBtn = document.getElementById('theme-toggle-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleTheme());
        }

        const state = this.store.getState();
        this.applyTheme(state.settings.theme || 'dark');
    }

    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        this.applyTheme(newTheme);

        const state = this.store.getState();
        const updatedSettings = { ...state.settings, theme: newTheme };
        this.store.setState({ settings: updatedSettings });

        toastEngine.show(`Mode ${newTheme === 'dark' ? 'Sombre' : 'Clair'} activé`, 'info');
    }

    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
    }
}

/* ==============================================================================
 * 16. SPA VIEW ROUTER & NAVIGATION
 * ============================================================================== */
class ViewRouter {
    constructor() {
        this.currentView = 'dashboard';
        this.navItems = document.querySelectorAll('#app-nav .nav-item');
        this.viewSections = document.querySelectorAll('.view-section');
        this.pageTitle = document.getElementById('page-title');
    }

    init() {
        this.navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const targetView = item.dataset.view;
                if (targetView) {
                    this.navigateTo(targetView);
                }
            });
        });
    }

    navigateTo(viewId) {
        this.currentView = viewId;

        // Update active class on sidebar items
        this.navItems.forEach(item => {
            if (item.dataset.view === viewId) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        // Toggle visibility of views
        this.viewSections.forEach(section => {
            if (section.id === `view-${viewId}`) {
                section.classList.add('active');
            } else {
                section.classList.remove('active');
            }
        });

        // Update header page title
        if (this.pageTitle) {
            const titles = {
                dashboard: 'Tableau de Bord',
                kanban: 'Kanban Board',
                tasks: 'Liste des Tâches',
                analytics: 'Analytique & Rapports',
                tracker: 'Gestionnaire de Temps',
                settings: 'Paramètres'
            };
            this.pageTitle.innerText = titles[viewId] || 'TaskFlow Pro';
        }

        globalEventBus.emit('viewChanged', viewId);
    }
}

/* ==============================================================================
 * 17. CORE APPLICATION CONTROLLER & BOOTSTRAPPER
 * ============================================================================== */
class Application {
    constructor() {
        this.store = new StateStore();
        this.router = new ViewRouter();
        this.modalManager = new ModalManager();
        this.kanbanController = new KanbanController(this.store);
        this.tableEngine = new DataTableEngine(this.store);
        this.timeTracker = new TimeTrackerEngine(this.store);
        this.shortcutManager = new ShortcutManager(this.store, this.modalManager);
        this.commandPalette = new CommandPalette(this.store);
        this.themeManager = new ThemeManager(this.store);
    }

    /**
     * Start and initialize the whole software system
     */
    bootstrap() {
        console.log('TaskFlow Pro System Bootstrapping...');

        // 1. Load initial data state
        if (!this.store.loadFromStorage()) {
            this.store.setState(MockApiService.getInitialSeedData(), false);
        }

        // 2. Initialize Subsystems
        this.router.init();
        this.kanbanController.init();
        this.tableEngine.init();
        this.timeTracker.init();
        this.shortcutManager.init();
        this.commandPalette.init();
        this.themeManager.init();

        // 3. Bind global event handlers
        this.bindGlobalEvents();

        // 4. Subscribe to state store changes for dynamic UI re-rendering
        this.store.subscribe((state) => this.renderUI(state));

        // 5. Initial Render trigger
        this.renderUI(this.store.getState());

        toastEngine.show('Bienvenue sur TaskFlow Pro!', 'success');
    }

    bindGlobalEvents() {
        // Quick create task button
        const quickTaskBtn = document.getElementById('btn-quick-task');
        if (quickTaskBtn) {
            quickTaskBtn.addEventListener('click', () => {
                this.modalManager.open('Créer une Tâche');
            });
        }

        // CSV Export Button
        const exportCsvBtn = document.getElementById('btn-export-csv');
        if (exportCsvBtn) {
            exportCsvBtn.addEventListener('click', () => {
                ExportImportEngine.exportTasksToCSV(this.store.getState().tasks);
            });
        }

        // Modal Form Submit Event
        const modalForm = document.getElementById('modal-task-form');
        if (modalForm) {
            const validator = new FormValidator(modalForm);
            modalForm.addEventListener('submit', (e) => {
                e.preventDefault();
                if (!validator.validateTaskForm()) return;

                const taskId = document.getElementById('task-id').value;
                const title = document.getElementById('task-title').value.trim();
                const priority = document.getElementById('task-priority').value;
                const status = document.getElementById('task-status').value;
                const dueDate = document.getElementById('task-due-date').value;

                const state = this.store.getState();
                let updatedTasks = [...state.tasks];

                if (taskId) {
                    // Edit Existing
                    updatedTasks = updatedTasks.map(t => t.id === taskId ? { ...t, title, priority, status, dueDate } : t);
                    toastEngine.show('Tâche mise à jour!', 'success');
                } else {
                    // Create New
                    const newTask = {
                        id: 'TSK-' + (Math.floor(Math.random() * 900) + 100),
                        title,
                        priority,
                        status,
                        dueDate,
                        createdAt: Utils.formatDate(new Date())
                    };
                    updatedTasks.push(newTask);
                    toastEngine.show('Nouvelle tâche créée!', 'success');
                }

                this.store.setState({ tasks: updatedTasks });
                this.modalManager.close();
            });
        }

        // Delegation listener for Edit & Delete buttons
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-delete-task')) {
                const taskId = e.target.dataset.id;
                if (confirm(`Voulez-vous vraiment supprimer la tâche ${taskId} ?`)) {
                    this.deleteTask(taskId);
                }
            } else if (e.target.classList.contains('btn-edit-task')) {
                const taskId = e.target.dataset.id;
                const task = this.store.getState().tasks.find(t => t.id === taskId);
                if (task) {
                    this.modalManager.open('Éditer la Tâche', task);
                }
            }
        });

        // Settings Form Submit
        const settingsForm = document.getElementById('settings-form');
        if (settingsForm) {
            settingsForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const username = document.getElementById('setting-username').value;
                const pageSize = parseInt(document.getElementById('setting-page-size').value, 10) || 5;

                const state = this.store.getState();
                const updatedSettings = { ...state.settings, username, pageSize };
                
                this.store.setState({ settings: updatedSettings });
                toastEngine.show('Paramètres enregistrés!', 'success');
            });
        }

        // Reset Data Button
        const resetBtn = document.getElementById('btn-reset-data');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                if (confirm('Attention! Toutes vos données seront réinitialisées à l\'état par défaut.')) {
                    this.store.setState(MockApiService.getInitialSeedData());
                    toastEngine.show('Données réinitialisées.', 'warning');
                }
            });
        }

        // Listen for view navigation changes to re-render charts
        globalEventBus.on('viewChanged', (viewId) => {
            if (viewId === 'dashboard' || viewId === 'analytics') {
                this.renderCharts(this.store.getState());
            }
        });
    }

    deleteTask(taskId) {
        const state = this.store.getState();
        const updatedTasks = state.tasks.filter(t => t.id !== taskId);
        const activityMsg = `Tâche ${taskId} supprimée`;
        const updatedActivity = [activityMsg, ...state.recentActivity].slice(0, 5);

        this.store.setState({ tasks: updatedTasks, recentActivity: updatedActivity });
        toastEngine.show('Tâche supprimée avec succès', 'warning');
    }

    /**
     * Render and sync all UI visual components based on current State
     * @param {Object} state 
     */
    renderUI(state) {
        const { tasks, timeLogs, recentActivity, settings } = state;

        // 1. KPI Counters Update
        const totalTasksEl = document.getElementById('kpi-total-tasks');
        const inProgressEl = document.getElementById('kpi-in-progress');
        const completedEl = document.getElementById('kpi-completed');
        const totalTimeEl = document.getElementById('kpi-total-time');

        if (totalTasksEl) totalTasksEl.innerText = tasks.length.toString();
        if (inProgressEl) inProgressEl.innerText = tasks.filter(t => t.status === 'in-progress').length.toString();
        if (completedEl) completedEl.innerText = tasks.filter(t => t.status === 'done').length.toString();
        
        if (totalTimeEl) {
            const totalSecs = timeLogs.reduce((acc, log) => acc + log.durationSeconds, 0);
            totalTimeEl.innerText = (totalSecs / 3600).toFixed(1);
        }

        // 2. Recent Activity List Update
        const activityList = document.getElementById('recent-activity-list');
        if (activityList && recentActivity) {
            activityList.innerHTML = recentActivity.map(act => `
                <li style="border-bottom: 1px dashed var(--border); color: var(--text-secondary); font-size: 0.85rem; padding: 0.25rem 0;">
                    📌 ${Utils.escapeHTML(act)}
                </li>
            `).join('');
        }

        // 3. Settings Form Sync
        const usernameInput = document.getElementById('setting-username');
        const pageSizeInput = document.getElementById('setting-page-size');
        if (usernameInput && settings.username) usernameInput.value = settings.username;
        if (pageSizeInput && settings.pageSize) pageSizeInput.value = settings.pageSize;

        // 4. Subsystem Renders
        this.kanbanController.render(tasks);
        this.tableEngine.render();
        this.timeTracker.updateSelectOptions(tasks);
        this.timeTracker.renderLogs(timeLogs);

        // 5. Canvas Charts Render
        this.renderCharts(state);
    }

    renderCharts(state) {
        const { tasks } = state;

        // Project Progress Bar Chart (Dashboard View)
        const todoCount = tasks.filter(t => t.status === 'todo').length;
        const inProgressCount = tasks.filter(t => t.status === 'in-progress').length;
        const reviewCount = tasks.filter(t => t.status === 'review').length;
        const doneCount = tasks.filter(t => t.status === 'done').length;

        CanvasChartEngine.renderBarChart('chart-project-progress', 
            ['À faire', 'En cours', 'Révision', 'Terminé'], 
            [todoCount, inProgressCount, reviewCount, doneCount]
        );

        // Priority Pie Chart (Analytics View)
        const highPriority = tasks.filter(t => t.priority === 'Haute').length;
        const medPriority = tasks.filter(t => t.priority === 'Moyenne').length;
        const lowPriority = tasks.filter(t => t.priority === 'Basse').length;

        CanvasChartEngine.renderPieChart('chart-priority-pie', [
            { label: 'Haute', value: highPriority, color: '#ef4444' },
            { label: 'Moyenne', value: medPriority, color: '#f59e0b' },
            { label: 'Basse', value: lowPriority, color: '#10b981' }
        ]);

        // Task Velocity Bar Chart (Analytics View)
        CanvasChartEngine.renderBarChart('chart-velocity-bar',
            ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'],
            [2, 5, 3, 8, 4, 1, 6]
        );
    }
}

/* ==============================================================================
 * APPLICATION BOOTSTRAP INITIALIZATION
 * ============================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    const app = new Application();
    app.bootstrap();
});