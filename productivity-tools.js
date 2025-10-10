/**
 * Productivity Tools Service
 * Handles calendar integration, task management, and email functionality
 */

const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');

class ProductivityToolsService {
    constructor() {
        this.gmailCredentials = {
            clientId: process.env.GMAIL_CLIENT_ID,
            clientSecret: process.env.GMAIL_CLIENT_SECRET,
            refreshToken: process.env.GMAIL_REFRESH_TOKEN
        };
        this.calendarCredentials = {
            clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
            refreshToken: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN
        };
        this.smtpConfig = {
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT || 587,
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        };
        
        this.tasks = new Map(); // In-memory task storage
        this.reminders = new Map(); // In-memory reminder storage
        this.initServices();
    }

    initServices() {
        // Initialize Gmail
        if (this.gmailCredentials.clientId && this.gmailCredentials.refreshToken) {
            this.gmail = google.gmail({ version: 'v1', auth: this.getOAuth2Client(this.gmailCredentials) });
        }

        // Initialize Calendar
        if (this.calendarCredentials.clientId && this.calendarCredentials.refreshToken) {
            this.calendar = google.calendar({ version: 'v3', auth: this.getOAuth2Client(this.calendarCredentials) });
        }

        // Initialize SMTP
        if (this.smtpConfig.auth.user && this.smtpConfig.auth.pass) {
            this.transporter = nodemailer.createTransporter(this.smtpConfig);
        }
    }

    getOAuth2Client(credentials) {
        const oauth2Client = new google.auth.OAuth2(
            credentials.clientId,
            credentials.clientSecret,
            'urn:ietf:wg:oauth:2.0:oob'
        );
        
        oauth2Client.setCredentials({
            refresh_token: credentials.refreshToken
        });
        
        return oauth2Client;
    }

    // Task Management
    createTask(userId, taskData) {
        const taskId = uuidv4();
        const task = {
            id: taskId,
            userId: userId,
            title: taskData.title,
            description: taskData.description || '',
            priority: taskData.priority || 'medium',
            status: 'pending',
            dueDate: taskData.dueDate || null,
            tags: taskData.tags || [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.tasks.set(taskId, task);
        return task;
    }

    getTasks(userId, filters = {}) {
        const userTasks = Array.from(this.tasks.values())
            .filter(task => task.userId === userId);

        let filteredTasks = userTasks;

        if (filters.status) {
            filteredTasks = filteredTasks.filter(task => task.status === filters.status);
        }

        if (filters.priority) {
            filteredTasks = filteredTasks.filter(task => task.priority === filters.priority);
        }

        if (filters.tag) {
            filteredTasks = filteredTasks.filter(task => 
                task.tags.includes(filters.tag)
            );
        }

        if (filters.dueSoon) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            filteredTasks = filteredTasks.filter(task => {
                if (!task.dueDate) return false;
                return new Date(task.dueDate) <= tomorrow;
            });
        }

        return filteredTasks.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }

    updateTask(taskId, updates) {
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error('Task not found');
        }

        const updatedTask = {
            ...task,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        this.tasks.set(taskId, updatedTask);
        return updatedTask;
    }

    deleteTask(taskId) {
        return this.tasks.delete(taskId);
    }

    completeTask(taskId) {
        return this.updateTask(taskId, { status: 'completed' });
    }

    // Reminder System
    createReminder(userId, reminderData) {
        const reminderId = uuidv4();
        const reminder = {
            id: reminderId,
            userId: userId,
            title: reminderData.title,
            message: reminderData.message,
            triggerTime: new Date(reminderData.triggerTime),
            type: reminderData.type || 'notification',
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        this.reminders.set(reminderId, reminder);
        
        // Schedule the reminder
        this.scheduleReminder(reminder);
        
        return reminder;
    }

    scheduleReminder(reminder) {
        const now = new Date();
        const triggerTime = new Date(reminder.triggerTime);
        
        if (triggerTime > now) {
            const delay = triggerTime.getTime() - now.getTime();
            
            setTimeout(() => {
                this.triggerReminder(reminder);
            }, delay);
        }
    }

    triggerReminder(reminder) {
        // Update reminder status
        reminder.status = 'triggered';
        this.reminders.set(reminder.id, reminder);
        
        // In a real implementation, this would send a Discord message
        console.log(`REMINDER: ${reminder.title} - ${reminder.message}`);
        
        return reminder;
    }

    getReminders(userId, status = 'pending') {
        return Array.from(this.reminders.values())
            .filter(reminder => reminder.userId === userId && reminder.status === status)
            .sort((a, b) => new Date(a.triggerTime) - new Date(b.triggerTime));
    }

    // Calendar Integration
    async createCalendarEvent(userId, eventData) {
        if (!this.calendar) {
            throw new Error('Calendar service not configured');
        }

        try {
            const event = {
                summary: eventData.title,
                description: eventData.description || '',
                start: {
                    dateTime: eventData.startTime,
                    timeZone: eventData.timeZone || 'UTC'
                },
                end: {
                    dateTime: eventData.endTime,
                    timeZone: eventData.timeZone || 'UTC'
                },
                attendees: eventData.attendees || [],
                reminders: {
                    useDefault: true
                }
            };

            const response = await this.calendar.events.insert({
                calendarId: 'primary',
                resource: event
            });

            return {
                id: response.data.id,
                title: eventData.title,
                startTime: eventData.startTime,
                endTime: eventData.endTime,
                link: response.data.htmlLink,
                status: 'created'
            };
        } catch (error) {
            console.error('Calendar event creation error:', error);
            throw error;
        }
    }

    async getUpcomingEvents(userId, days = 7) {
        if (!this.calendar) {
            throw new Error('Calendar service not configured');
        }

        try {
            const now = new Date();
            const future = new Date(now.getTime() + (days * 24 * 60 * 60 * 1000));

            const response = await this.calendar.events.list({
                calendarId: 'primary',
                timeMin: now.toISOString(),
                timeMax: future.toISOString(),
                singleEvents: true,
                orderBy: 'startTime'
            });

            return response.data.items.map(event => ({
                id: event.id,
                title: event.summary,
                description: event.description,
                startTime: event.start.dateTime || event.start.date,
                endTime: event.end.dateTime || event.end.date,
                location: event.location,
                attendees: event.attendees || [],
                link: event.htmlLink
            }));
        } catch (error) {
            console.error('Calendar fetch error:', error);
            throw error;
        }
    }

    // Email Integration
    async sendEmail(emailData) {
        if (this.gmail) {
            return await this.sendEmailGmail(emailData);
        } else if (this.transporter) {
            return await this.sendEmailSMTP(emailData);
        } else {
            throw new Error('Email service not configured');
        }
    }

    async sendEmailGmail(emailData) {
        try {
            const message = {
                to: emailData.to,
                subject: emailData.subject,
                text: emailData.text || '',
                html: emailData.html || ''
            };

            const response = await this.gmail.users.messages.send({
                userId: 'me',
                resource: {
                    raw: Buffer.from(
                        `To: ${message.to}\r\n` +
                        `Subject: ${message.subject}\r\n` +
                        `Content-Type: text/html; charset=utf-8\r\n\r\n` +
                        message.html
                    ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
                }
            });

            return {
                success: true,
                messageId: response.data.id,
                method: 'gmail'
            };
        } catch (error) {
            console.error('Gmail send error:', error);
            throw error;
        }
    }

    async sendEmailSMTP(emailData) {
        try {
            const info = await this.transporter.sendMail({
                from: this.smtpConfig.auth.user,
                to: emailData.to,
                subject: emailData.subject,
                text: emailData.text || '',
                html: emailData.html || ''
            });

            return {
                success: true,
                messageId: info.messageId,
                method: 'smtp'
            };
        } catch (error) {
            console.error('SMTP send error:', error);
            throw error;
        }
    }

    // Note Taking System
    createNote(userId, noteData) {
        const noteId = uuidv4();
        const note = {
            id: noteId,
            userId: userId,
            title: noteData.title,
            content: noteData.content,
            tags: noteData.tags || [],
            category: noteData.category || 'general',
            isPinned: noteData.isPinned || false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // In a real implementation, this would be stored in a database
        // For now, we'll use the same in-memory storage as tasks
        this.tasks.set(`note_${noteId}`, note);
        
        return note;
    }

    getNotes(userId, filters = {}) {
        const userNotes = Array.from(this.tasks.values())
            .filter(task => task.userId === userId && task.id.startsWith('note_'));

        let filteredNotes = userNotes;

        if (filters.category) {
            filteredNotes = filteredNotes.filter(note => note.category === filters.category);
        }

        if (filters.tag) {
            filteredNotes = filteredNotes.filter(note => 
                note.tags.includes(filters.tag)
            );
        }

        if (filters.pinned) {
            filteredNotes = filteredNotes.filter(note => note.isPinned);
        }

        return filteredNotes.sort((a, b) => {
            if (a.isPinned && !b.isPinned) return -1;
            if (!a.isPinned && b.isPinned) return 1;
            return new Date(b.updatedAt) - new Date(a.updatedAt);
        });
    }

    updateNote(noteId, updates) {
        const note = this.tasks.get(`note_${noteId}`);
        if (!note) {
            throw new Error('Note not found');
        }

        const updatedNote = {
            ...note,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        this.tasks.set(`note_${noteId}`, updatedNote);
        return updatedNote;
    }

    deleteNote(noteId) {
        return this.tasks.delete(`note_${noteId}`);
    }

    // Productivity Analytics
    getProductivityStats(userId) {
        const userTasks = Array.from(this.tasks.values())
            .filter(task => task.userId === userId && !task.id.startsWith('note_'));

        const completedTasks = userTasks.filter(task => task.status === 'completed');
        const pendingTasks = userTasks.filter(task => task.status === 'pending');

        const today = new Date().toDateString();
        const todayTasks = userTasks.filter(task => 
            new Date(task.createdAt).toDateString() === today
        );

        return {
            totalTasks: userTasks.length,
            completedTasks: completedTasks.length,
            pendingTasks: pendingTasks.length,
            completionRate: userTasks.length > 0 ? 
                (completedTasks.length / userTasks.length * 100).toFixed(1) : 0,
            todayTasks: todayTasks.length,
            overdueTasks: this.getOverdueTasks(userId).length
        };
    }

    getOverdueTasks(userId) {
        const now = new Date();
        return Array.from(this.tasks.values())
            .filter(task => 
                task.userId === userId && 
                task.status === 'pending' &&
                task.dueDate &&
                new Date(task.dueDate) < now
            );
    }

    // Quick Actions
    async quickSchedule(userId, title, duration = 60) {
        const startTime = new Date();
        const endTime = new Date(startTime.getTime() + (duration * 60 * 1000));

        return await this.createCalendarEvent(userId, {
            title: title,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString()
        });
    }

    async quickReminder(userId, message, minutes = 30) {
        const triggerTime = new Date();
        triggerTime.setMinutes(triggerTime.getMinutes() + minutes);

        return this.createReminder(userId, {
            title: 'Quick Reminder',
            message: message,
            triggerTime: triggerTime.toISOString()
        });
    }

    async quickEmail(to, subject, message) {
        return await this.sendEmail({
            to: to,
            subject: subject,
            text: message,
            html: `<p>${message.replace(/\n/g, '<br>')}</p>`
        });
    }
}

module.exports = new ProductivityToolsService();
