import crypto from "crypto";
import Booking from "../models/booking.model.js";
import Listing from "../models/listing.model.js";
import ExpressError from "../Middlewares/ExpressError.js";

// Demo payment gateway. Signs payments with a server-side secret,
// the same way a real gateway does. Reuses SESSION_SECRET so no new env var is needed.
const signPayment = (orderId, paymentId) =>
	crypto
		.createHmac("sha256", process.env.SESSION_SECRET || "demo-secret")
		.update(`${orderId}|${paymentId}`)
		.digest("hex");

// Step A: validate, calculate price on the server, create a pending booking + mock order
export const createOrder = async (req, res) => {
	const { id } = req.params;
	const { checkIn, checkOut, guests, specialRequests } = req.body.booking || {};

	const listing = await Listing.findById(id);
	if (!listing) return res.status(404).json({ error: "Listing not found!" });
	if (!listing.isAvailable || listing.listingStatus !== "active") {
		return res.status(400).json({ error: "This listing is not available for booking." });
	}

	const inDate = new Date(checkIn);
	const outDate = new Date(checkOut);
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	if (isNaN(inDate) || isNaN(outDate) || outDate <= inDate || inDate < today) {
		return res.status(400).json({ error: "Please choose valid check-in and check-out dates." });
	}

	const guestCount = Number(guests);
	if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 20) {
		return res.status(400).json({ error: "Guests must be between 1 and 20." });
	}

	// Block double-booking of already confirmed stays
	const clash = await Booking.exists({
		listing: id,
		status: "confirmed",
		checkIn: { $lt: outDate },
		checkOut: { $gt: inDate },
	});
	if (clash) {
		return res.status(409).json({ error: "These dates are already booked." });
	}

	// Price is calculated here, never trusted from the browser
	const nights = Math.round((outDate - inDate) / (1000 * 60 * 60 * 24));
	const totalPrice = nights * listing.price;

	const orderId = "order_mock_" + crypto.randomBytes(8).toString("hex");

	await Booking.create({
		listing: id,
		user: req.user._id,
		checkIn: inDate,
		checkOut: outDate,
		guests: guestCount,
		totalPrice,
		specialRequests: specialRequests || "",
		status: "pending",
		paymentStatus: "pending",
		paymentProvider: "mock",
		paymentOrderId: orderId,
	});

	res.json({ orderId, amount: totalPrice, currency: "INR" });
};

// Step B: the fake gateway. Stands in for the Razorpay popup.
// Remove this function and its route when you switch to real Razorpay.
export const mockPay = async (req, res) => {
	const { orderId, outcome } = req.body;

	const booking = await Booking.findOne({
		paymentOrderId: orderId,
		user: req.user._id,
		paymentStatus: "pending",
	});
	if (!booking) return res.status(404).json({ error: "Order not found." });

	if (outcome !== "success") {
		booking.paymentStatus = "failed";
		await booking.save();
		return res.status(402).json({ error: "Payment declined. Please try another card." });
	}

	const paymentId = "pay_mock_" + crypto.randomBytes(8).toString("hex");
	res.json({
		orderId,
		paymentId,
		signature: signPayment(orderId, paymentId),
	});
};

// Step C: verify the signature, then confirm the booking
export const verifyPayment = async (req, res) => {
	const { orderId, paymentId, signature } = req.body;

	if (!orderId || !paymentId || !signature) {
		return res.status(400).json({ error: "Invalid payment data." });
	}

	const booking = await Booking.findOne({
		paymentOrderId: orderId,
		user: req.user._id,
	});
	if (!booking) return res.status(404).json({ error: "Booking not found." });

	const a = Buffer.from(signPayment(orderId, paymentId));
	const b = Buffer.from(String(signature));
	const valid = a.length === b.length && crypto.timingSafeEqual(a, b);

	if (!valid) {
		if (booking.paymentStatus !== "paid") {
			booking.paymentStatus = "failed";
			await booking.save();
		}
		return res.status(400).json({ error: "Payment verification failed." });
	}

	if (booking.paymentStatus !== "paid") {
		booking.paymentStatus = "paid";
		booking.status = "confirmed";
		booking.paymentId = paymentId;
		await booking.save();
	}

	req.flash("success", "Booking and Payment successful!");
	res.json({ redirect: `/listing/${booking.listing}` });
};

export const getBookingForm = async (req, res, next) => {
	const { id } = req.params;

	const listing = await Listing.findById(id);
	if (!listing) {
		req.flash("error", "Listing not found!");
		return res.redirect('/listing');
	}

	res.render('bookings/new.ejs', { listing });
};

export const getMyBookings = async (req, res) => {
	const bookings = await Booking.find({ user: req.user._id })
		.populate("listing")
		.sort({ createdAt: -1 });

	res.status(200).json({ bookings });
};

export const getBookingById = async (req, res, next) => {
	const { bookingId } = req.params;

	const booking = await Booking.findById(bookingId)
		.populate("listing")
		.populate("user", "firstName lastName username email");

	if (!booking) {
		return next(new ExpressError(404, "Booking not found!"));
	}

	if (booking.user._id.toString() !== req.user._id.toString()) {
		return next(new ExpressError(403, "You are not authorized to access this booking!"));
	}

	res.status(200).json({ booking });
};

export const cancelBooking = async (req, res, next) => {
	const { bookingId } = req.params;

	const booking = await Booking.findById(bookingId);
	if (!booking) {
		return next(new ExpressError(404, "Booking not found!"));
	}

	if (booking.user.toString() !== req.user._id.toString()) {
		return next(new ExpressError(403, "You are not authorized to cancel this booking!"));
	}

	booking.status = "cancelled";
	await booking.save();

	req.flash("success", "Booking cancelled successfully!");
	res.redirect("/profile");
};

export const deleteBooking = async (req, res, next) => {
	const { bookingId } = req.params;

	const booking = await Booking.findById(bookingId);
	if (!booking) {
		return next(new ExpressError(404, "Booking not found!"));
	}

	if (booking.user.toString() !== req.user._id.toString()) {
		return next(new ExpressError(403, "You are not authorized to delete this booking!"));
	}

	await Booking.findByIdAndDelete(bookingId);

	req.flash("success", "Booking deleted successfully!");
	res.redirect("/profile");
};