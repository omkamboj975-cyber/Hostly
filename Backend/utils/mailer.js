import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

// Local fallback: Gmail SMTP (blocked on Render's free plan)
let gmailTransporter;
const getGmailTransporter = () => {
    if (!gmailTransporter) {
        gmailTransporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.GMAIL_USER,
                pass: process.env.GMAIL_PASS,
            }
        });
    }
    return gmailTransporter;
};

// Production: Brevo over HTTPS
const sendWithBrevo = async ({ to, subject, html }) => {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
            'api-key': process.env.BREVO_API_KEY,
            'Content-Type': 'application/json',
            'accept': 'application/json',
        },
        body: JSON.stringify({
            sender: {
                name: 'Hotspot',
                email: process.env.BREVO_SENDER_EMAIL || process.env.GMAIL_USER,
            },
            to: [{ email: to }],
            subject,
            htmlContent: html,
        }),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('Brevo error:', res.status, text);
        throw new Error('Failed to send email');
    }
};

const sendMail = async ({ to, subject, html }) => {
    if (process.env.BREVO_API_KEY) {
        return sendWithBrevo({ to, subject, html });
    }
    return getGmailTransporter().sendMail({
        from: `"Hotspot" <${process.env.GMAIL_USER}>`,
        to,
        subject,
        html,
    });
};

export const sendOTPEmail = async (email, otp, firstName) => {
    await sendMail({
        to: email,
        subject: "Verify your Hotspot account",
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem; border: 1px solid #ebebeb; border-radius: 12px;">
                <h2 style="color: #222; margin-bottom: 0.5rem;">Welcome to Hotspot, ${firstName}!</h2>
                <p style="color: #555; margin-bottom: 1.5rem;">Use the OTP below to verify your email. It expires in <strong>10 minutes</strong>.</p>
                <div style="background-color: #fff5f5; border: 1px solid #ffd5d5; border-radius: 8px; padding: 1.5rem; text-align: center; margin-bottom: 1.5rem;">
                    <p style="font-size: 2rem; font-weight: 700; color: #fe424d; letter-spacing: 0.5rem; margin: 0;">${otp}</p>
                </div>
                <p style="color: #888; font-size: 0.85rem;">If you did not create an account, please ignore this email.</p>
                <hr style="border: none; border-top: 1px solid #ebebeb; margin: 1.5rem 0;">
                <p style="color: #888; font-size: 0.8rem; margin: 0;">© Hotspot Private Limited</p>
            </div>
        `
    });
};