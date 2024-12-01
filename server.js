

require('dotenv').config();
const express = require('express');
const cors = require('cors');  // Import CORS
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
const port = 3000;

// Enable CORS for all requests
app.use(cors());
app.use(express.json()); // Middleware to parse JSON bodies

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

//get setsubi list from mongodb
app.get('/getSetsubiList', async (req, res) => {
  try {
    await client.connect();
    const database = client.db("Sasaki_Coating_MasterDB");
    const collection = database.collection("setsubiList");

    const factory = req.query.factory;
    const query = { "工場": factory };
    const projection = { "設備": 1, _id: 0 };

    const result = await collection.find(query).project(projection).toArray();
    res.json(result);
  } catch (error) {
    console.error("Error retrieving data:", error);
    res.status(500).send("Error retrieving data");
  }
});

//get sebanggo from mongoDB
app.get('/getSetsubiByProcess', async (req, res) => {
    try {
      await client.connect();
      const database = client.db("Sasaki_Coating_MasterDB");
      const collection = database.collection("setsubiList");
  
      let process = req.query.process;  // The process to search for
  
      if (!process) {
        return res.status(400).send("Process parameter is required");
      }
  
      // Escape special regex characters in the process value
      process = process.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escapes special characters
  
      // Create a regex pattern to match the `process` value as part of a comma-separated list
      const query = { 
        出来る設備: { 
          $regex: new RegExp(`(^|,\\s*)${process}(,|$)`, 'i')  // Match the `process` value between commas or at the start/end of the string
        }
      };
  
      const projection = { 背番号: 1, _id: 0 };  // Only return the `背番号` field
  
      const result = await collection.find(query).project(projection).toArray();
      res.json(result);  // Send back the array of `背番号`
    } catch (error) {
      console.error("Error retrieving data:", error);
      res.status(500).send("Error retrieving data");
    }
  });



  // Get product info from MongoDB
app.get('/getProductDetails', async (req, res) => {
  try {
    await client.connect();

    // Query masterDB for product details
    const masterDatabase = client.db("Sasaki_Coating_MasterDB");
    const masterCollection = masterDatabase.collection("masterDB");

    // Get values from the query parameters
    const serialNumber = req.query.serialNumber; // 背番号 value from sub-dropdown
    const factory = req.query.factory;          // 工場 value from hidden input

    if (!serialNumber) {
      return res.status(400).send("Serial number is required");
    }

    // Check for duplicates of `背番号`
    const duplicateCount = await masterCollection.countDocuments({ 背番号: serialNumber });

    // Query to match documents based on presence of duplicates
    let query;
    if (duplicateCount > 1) {
      query = { 背番号: serialNumber, 工場: factory };
    } else {
      query = { 背番号: serialNumber };
    }

    // Find the matching document in masterDB
    const productDetails = await masterCollection.findOne(query, {
      projection: {
        品番: 1,
        モデル: 1,
        形状: 1,
        "R/L": 1,
        材料: 1,
        材料背番号: 1,
        色: 1,
        送りピッチ: 1,
        型番: 1,
        _id: 0,
      }
    });

    // Query pictureDB for additional info
    const pictureCollection = masterDatabase.collection("pictureDB");
    const pictureDetails = await pictureCollection.findOne(
      { 背番号: serialNumber },
      { projection: { "html website": 1, _id: 0 } }
    );

    // Combine results
    const combinedResult = {
      ...productDetails,
      htmlWebsite: pictureDetails ? pictureDetails["html website"] : null, // Include html website if found
    };

    // If no document is found in masterDB, return an empty response
    if (!productDetails) {
      return res.status(404).send("No matching product found");
    }

    // Send the combined result as JSON
    res.json(combinedResult);

  } catch (error) {
    console.error("Error retrieving product details:", error);
    res.status(500).send("Error retrieving product details");
  }
});



  //get worker name
  app.get('/getWorkerNames', async (req, res) => {
    try {
      await client.connect();
      const database = client.db("Sasaki_Coating_MasterDB");
      const collection = database.collection("workerDB");
  
      // Get the factory value from the query parameters
      const selectedFactory = req.query.selectedFactory; // HTML value of id="selected工場"
  
      if (!selectedFactory) {
        return res.status(400).send("Factory is required");
      }
  
      // Find workers where `部署` contains the selected factory
      const workers = await collection.find(
        { 部署: { $regex: new RegExp(`(^|,)${selectedFactory}(,|$)`) } }, 
        { projection: { Name: 1, _id: 0 } } // Retrieve only the "Name" field
      ).toArray();
  
      if (workers.length === 0) {
        return res.status(404).send("No matching workers found for the selected factory");
      }
  
      // Send the list of worker names as JSON
      res.json(workers.map(worker => worker.Name));
  
    } catch (error) {
      console.error("Error retrieving worker names:", error);
      res.status(500).send("Error retrieving worker names");
    }
  });


  // Route to handle form submission for pressDB
app.post('/submitPressData', async (req, res) => {
  try {
    console.log('Raw Request Body:', req.body); // Debug the incoming request body

    await client.connect();
    const database = client.db("submittedDB");
    const pressDB = database.collection("pressDB");
    const currentCountDB = database.collection("currentCountDB");

    // Rename "Date" field to avoid conflict with JavaScript's Date constructor
    const {
      uniqueID,
      背番号,
      品番,
      Worker_Name,
      Date: dateField, // Rename Date to dateField
      Time_start,
      Time_end,
      設備,
      材料ロット,
      Remaining_Quantity,
      疵引不良,
      加工不良,
      Total_NG,
      Total,
      Spare,
      ScannedQR,
      Process_Quantity,
      その他,
      Cycle_Time,
      Process_Status
    } = req.body;

    // Construct the document to insert into pressDB
    const document = {
      uniqueID,
      背番号,
      品番,
      Worker_Name,
      Date: new Date(dateField), // Use renamed dateField here
      Time_start,
      Time_end,
      設備,
      材料ロット,
      Remaining_Quantity: parseInt(Remaining_Quantity, 10),
      疵引不良: parseInt(疵引不良, 10),
      加工不良: parseInt(加工不良, 10),
      Total_NG: parseInt(Total_NG, 10),
      Total: parseInt(Total, 10),
      Spare: parseInt(Spare, 10),
      ScannedQR,
      Process_Quantity: parseInt(Process_Quantity, 10),
      その他: parseInt(その他, 10),
      Cycle_Time: parseFloat(Cycle_Time),
      Process_Status
    };

    // Insert into pressDB
    const result = await pressDB.insertOne(document);

    // Check if uniqueID exists in currentCountDB
    let currentCountEntry = await currentCountDB.findOne({ uniqueID });

    if (!currentCountEntry) {
      // If no entry exists, create a new one
      await currentCountDB.insertOne({
        uniqueID,
        背番号,
        品番,
        pressDB_Remaining_Quantity: parseInt(Total, 10), // Initialize with Total from pressDB
        slitDB_Remaining_Quantity: 0,
        SRSDB_Remaining_Quantity: 0,
        pressDB_Date: new Date(dateField),
        ScannedQR
      });
    } else {
      // If entry exists, update pressDB_Remaining_Quantity
      const updatedPressDBQuantity = (currentCountEntry.pressDB_Remaining_Quantity || 0) + parseInt(Total, 10);

      await currentCountDB.updateOne(
        { uniqueID },
        {
          $set: {
            pressDB_Remaining_Quantity: updatedPressDBQuantity, // Add Total to existing Remaining Quantity
            pressDB_Date: new Date(dateField), // Update Date field
            品番,
            ScannedQR
          }
        }
      );
    }

    res.status(201).json({ insertedId: result.insertedId });
  } catch (error) {
    console.error("Error inserting press data:", error);
    res.status(500).send("Error inserting press data");
  }
});




  //Route to check if processing 
  app.post('/checkQRStatus', async (req, res) => {
    try {
      const { ScannedQR } = req.body;
  
      if (!ScannedQR) {
        return res.status(400).json({ error: 'ScannedQR is required' });
      }
  
      console.log(`Checking QR status for: ${ScannedQR}`); // Debug log
  
      await client.connect();
      const database = client.db("submittedDB");
      const collection = database.collection("pressDB");
  
      // Check if ScannedQR exists with Process_Status = "processing"
      const existingEntry = await collection.findOne({
        ScannedQR,
        Process_Status: "processing"
      });
  
      console.log(`Query Result:`, existingEntry); // Log query result
  
      if (existingEntry) {
        return res.json({ isProcessing: true });
      }
  
      return res.json({ isProcessing: false });
    } catch (error) {
      console.error("Error checking QR status:", error);
      res.status(500).send("Error checking QR status");
    }
  });

  



///////////////////////////////
// SRS ROUTE
//////////////////////////////

// SRS scan-button
//this route is to check if slit is ari, therefore get value from slit remaining qty else pressDB
app.post('/processSRS', async (req, res) => {
  try {
    const { ScannedQR } = req.body;

    if (!ScannedQR) {
      return res.status(400).json({ error: "ScannedQR is required" });
    }

    console.log(`Processing SRS QR: ${ScannedQR}`);

    await client.connect();
    const submittedDB = client.db("submittedDB");
    const pressDB = submittedDB.collection("pressDB");
    const currentCountDB = submittedDB.collection("currentCountDB");

    // Step 1: Find the row in pressDB with ScannedQR and Process_Status = "processing"
    const pressEntry = await pressDB.findOne({ ScannedQR, Process_Status: "processing" });

    if (!pressEntry) {
      return res.status(404).json({ error: "QR not found or not in processing state in pressDB" });
    }

    const { 背番号, Remaining_Quantity: pressRemainingQuantity, uniqueID, Date } = pressEntry;

    // Step 2: Check masterDB for the 背番号
    const masterDB = client.db("Sasaki_Coating_MasterDB").collection("masterDB");
    const masterEntry = await masterDB.findOne({ 背番号 });

    if (!masterEntry) {
      return res.status(404).json({ error: "背番号 not found in masterDB" });
    }

    const { SRS, SLIT } = masterEntry;

    if (!SRS || SRS === "無し") {
      return res.status(400).json({ error: "This product is not for SRS process" });
    }

    // Step 3: Handle SLIT and SRS logic
    if (SRS === "有り") {
      if (SLIT === "有り") {
        // Check currentCountDB for slitDB_Remaining_Quantity
        let currentCountEntry = await currentCountDB.findOne({ uniqueID });

        if (!currentCountEntry) {
          // Insert a new entry in currentCountDB if not found
          await currentCountDB.insertOne({
            uniqueID,
            背番号,
            ScannedQR,
            pressDB_Date: Date,
            pressDB_Remaining_Quantity: pressRemainingQuantity,
            slitDB_Remaining_Quantity: 0,
            SRSDB_Remaining_Quantity: 0,
          });

          currentCountEntry = await currentCountDB.findOne({ uniqueID });
        }

        const { slitDB_Remaining_Quantity } = currentCountEntry;

        if (slitDB_Remaining_Quantity === 0) {
          return res.status(400).json({ error: "No remaining quantity in slitDB. Please process slits first." });
        }

        return res.json({
          uniqueID,
          Remaining_Quantity: slitDB_Remaining_Quantity,
          背番号,
          source: "slitDB",
        });
      } else if (SLIT === "無し") {
        currentCountEntry = await currentCountDB.findOne({ uniqueID });
        const { pressDB_Remaining_Quantity } = currentCountEntry;
        // Check Remaining_Quantity in pressDB
        if (pressDB_Remaining_Quantity === 0) {
          return res.status(400).json({ error: "No remaining quantity in pressDB. Process completed." });
        }

        return res.json({
          uniqueID,
          Remaining_Quantity: pressDB_Remaining_Quantity,
          背番号,
          source: "pressDB",
        });
      }
    }

    // Handle unexpected cases
    return res.status(400).json({ error: "Invalid process configuration for SRS" });
  } catch (error) {
    console.error("Error processing SRS QR:", error);
    res.status(500).send("Error processing SRS QR.");
  }
});




// This route submits data to SRSDB and updates the value of currentCountDB
app.post('/submitToSRSDB', async (req, res) => {
  try {
    const formData = req.body;
    const { uniqueID, Total, SRS_Total_NG, 設備, ScannedQR, Date,Worker_Name } = formData;

    await client.connect();
    const database = client.db('submittedDB');
    const SRSDB = database.collection('SRSDB');
    const currentCountDB = database.collection('currentCountDB');
    const deductionLogDB = database.collection('deduction_LogDB'); // Deduction Log collection

    // Step 1: Insert the new record into SRSDB
    const result = await SRSDB.insertOne(formData);

    // Step 2: Fetch current counts from currentCountDB
    const currentCountEntry = await currentCountDB.findOne({ uniqueID });

    if (!currentCountEntry) {
      return res.status(404).json({ error: "UniqueID not found in currentCountDB" });
    }

    const { slitDB_Remaining_Quantity, pressDB_Remaining_Quantity } = currentCountEntry;

    // Step 3: Determine which quantity to update based on SLIT status
    const masterDB = client.db("Sasaki_Coating_MasterDB").collection("masterDB");
    const masterEntry = await masterDB.findOne({ 背番号: currentCountEntry.背番号 });

    if (!masterEntry) {
      return res.status(404).json({ error: "背番号 not found in masterDB" });
    }

    const { SLIT } = masterEntry;

    // Calculate deduction quantity
    const deductionQty = Total + SRS_Total_NG; // Deduction amount

    // Insert deduction into deduction_LogDB
    const now = new global.Date();
    const deductionData = {
      uniqueID,
      Date: now.toISOString().split('T')[0], // YYYY-MM-DD
      Time: now.toTimeString().split(' ')[0], // HH:mm:ss
      Name: Worker_Name, // Replace with the appropriate worker name if needed
      Log: `Total:${Total}, SRS_Total_NG:${SRS_Total_NG} from ${設備 || "N/A"}`,
    };

    let updatedRemainingQuantity; // Variable to store the updated remaining quantity

    if (SLIT === "有り") {
      // Deduct from slitDB_Remaining_Quantity
      deductionData.slitDB_deduction_Qty = deductionQty;
      await deductionLogDB.insertOne(deductionData);

      // Calculate remaining quantity for slitDB
      updatedRemainingQuantity = await calculateRemainingQuantity(
        database,
        'slitDB',
        'Total',
        'slitDB_deduction_Qty',
        uniqueID
      );

      await currentCountDB.updateOne(
        { uniqueID },
        {
          $set: {
            slitDB_Remaining_Quantity: updatedRemainingQuantity,
          },
        }
      );
    } else {
      // Deduct from pressDB_Remaining_Quantity
      deductionData.pressDB_deduction_Qty = deductionQty;
      await deductionLogDB.insertOne(deductionData);

      // Calculate remaining quantity for pressDB
      updatedRemainingQuantity = await calculateRemainingQuantity(
        database,
        'pressDB',
        'Total',
        'pressDB_deduction_Qty',
        uniqueID
      );

      await currentCountDB.updateOne(
        { uniqueID },
        {
          $set: {
            pressDB_Remaining_Quantity: updatedRemainingQuantity,
          },
        }
      );
    }

    // Step 4: Calculate and update the remaining quantity for SRSDB
    const updatedSRSQuantity = await calculateRemainingQuantity(
      database,
      'SRSDB',
      'Total',
      'SRSDB_deduction_Qty',
      uniqueID
    );

    await currentCountDB.updateOne(
      { uniqueID },
      {
        $set: {
          SRSDB_Remaining_Quantity: updatedSRSQuantity,
        },
      }
    );

    res.status(201).json({ insertedId: result.insertedId, message: "Form submitted and updated successfully" });
  } catch (error) {
    console.error("Error saving to SRSDB:", error);
    res.status(500).send("Error saving to SRSDB");
  }
});

/**
 * Helper function to calculate remaining quantity
 */
async function calculateRemainingQuantity(database, collectionName, totalField, deductionField, uniqueID) {
  const totalAggregation = await database.collection(collectionName).aggregate([
    { $match: { uniqueID } },
    { $group: { _id: "$uniqueID", total: { $sum: `$${totalField}` } } },
  ]).toArray();

  const totalInserted = totalAggregation.length > 0 ? totalAggregation[0].total : 0;

  const deductionAggregation = await database.collection('deduction_LogDB').aggregate([
    { $match: { uniqueID } },
    { $group: { _id: "$uniqueID", totalDeducted: { $sum: `$${deductionField}` } } },
  ]).toArray();

  const totalDeducted = deductionAggregation.length > 0 ? deductionAggregation[0].totalDeducted : 0;

  return totalInserted - totalDeducted;
}

//////////////////////////////////////
//
// SLit ROUTE
//
//////////////////////////////////
//slit process scan-button route
// Process SLIT
app.post('/processSLIT', async (req, res) => {
  try {
    const { ScannedQR } = req.body;

    if (!ScannedQR) {
      return res.status(400).json({ error: "ScannedQR is required" });
    }

    console.log(`Processing SLIT QR: ${ScannedQR}`);

    await client.connect();
    const submittedDB = client.db("submittedDB");
    const pressDB = submittedDB.collection("pressDB");
    const currentCountDB = submittedDB.collection("currentCountDB");

    // Step 1: Find the row in pressDB with ScannedQR and Process_Status = "processing"
    const pressEntry = await pressDB.findOne({ ScannedQR, Process_Status: "processing" });

    if (!pressEntry) {
      return res.status(404).json({ error: "QR not found or not in processing state in pressDB" });
    }

    const { 背番号, Remaining_Quantity, uniqueID, Date } = pressEntry; // Include Date field



    // Step 2: Check masterDB for the 背番号
    const masterDB = client.db("Sasaki_Coating_MasterDB").collection("masterDB");
    const masterEntry = await masterDB.findOne({ 背番号 });

    if (!masterEntry) {
      return res.status(404).json({ error: "背番号 not found in masterDB" });
    }

    const { SLIT } = masterEntry; // Check SLIT status

    if (!SLIT || SLIT === "無し") {
      return res.status(400).json({ error: "This is not for SLIT process" });
    }

    // Step 3: Ensure currentCountDB entry exists
    let currentCountEntry = await currentCountDB.findOne({ uniqueID });

    if (!currentCountEntry) {
      // Insert a new entry if not found
      await currentCountDB.insertOne({
        uniqueID,
        背番号,
        品番: masterEntry.品番 || "",
        ScannedQR,
        pressDB_Date: Date, // Include Date from pressDB
        pressDB_Remaining_Quantity: Remaining_Quantity, // Initialize Remaining_Quantity here
        slitDB_Remaining_Quantity: 0,
        SRSDB_Remaining_Quantity: 0,
      });

      // Fetch the newly created entry
      currentCountEntry = await currentCountDB.findOne({ uniqueID });
    }

    if (currentCountEntry.pressDB_Remaining_Quantity === 0) {
      return res.status(400).json({ error: "No remaining quantity in pressDB. Please check press process first." });
    }
    // Step 4: Return the required details
    return res.json({
      uniqueID,
      pressDB_Remaining_Quantity: currentCountEntry.pressDB_Remaining_Quantity,
      背番号,
      ScannedQR,
      pressDB_Date: Date, // Include pressDB's Date
      source: "pressDB",
    });
  } catch (error) {
    console.error("Error processing SLIT QR:", error);
    res.status(500).send("Error processing SLIT QR.");
  }
});



// Submit to slitDB and update currentCountDB and deduction_LogDB
app.post('/submitToSlitDB', async (req, res) => {
  try {
    const formData = req.body;
    const { uniqueID, Total, Total_NG, ScannedQR, Date, Worker_Name, 設備 } = formData;

    await client.connect();
    const database = client.db('submittedDB');
    const slitDB = database.collection('slitDB');
    const pressDB = database.collection('pressDB');
    const currentCountDB = database.collection('currentCountDB');
    const deductionLogDB = database.collection('deduction_LogDB'); // New collection

    // Step 1: Insert the new record into slitDB
    const result = await slitDB.insertOne(formData);

    // Step 2: Insert a new record into deduction_LogDB
    const now = new global.Date(); // Current date and time
    const deductionData = {
      uniqueID,
      pressDB_deduction_Qty: Total + Total_NG, // Deduction quantity for pressDB
      Date: now.toISOString().split('T')[0], // Extracts the date (YYYY-MM-DD)
      Time: now.toTimeString().split(' ')[0], // Extracts the time (HH:mm:ss)
      Name: Worker_Name,
      Log: `Total:${Total}, Total_NG:${Total_NG} from ${設備}`,
    };
    await deductionLogDB.insertOne(deductionData);

    // Step 3: Calculate the total "Total" value from pressDB for this uniqueID
    const pressAggregation = await pressDB.aggregate([
      { $match: { uniqueID } },
      { $group: { _id: "$uniqueID", totalPress: { $sum: "$Total" } } },
    ]).toArray();

    if (pressAggregation.length === 0) {
      return res.status(404).json({ error: "No records found in pressDB for this uniqueID" });
    }

    const totalPress = pressAggregation[0].totalPress;

    // Step 4: Calculate the updated slitDB_Remaining_Quantity for this uniqueID
    const slitAggregation = await slitDB.aggregate([
      { $match: { uniqueID } },
      { $group: { _id: "$uniqueID", totalInserted: { $sum: "$Total" } } },
    ]).toArray();

    if (slitAggregation.length === 0) {
      return res.status(404).json({ error: "No records found in slitDB for this uniqueID" });
    }

    const totalSlitInserted = slitAggregation[0].totalInserted;

    // Step 5: Calculate total deductions for slitDB and pressDB
    const deductionAggregation = await deductionLogDB.aggregate([
      { $match: { uniqueID } },
      {
        $group: {
          _id: "$uniqueID",
          totalPressDeducted: { $sum: "$pressDB_deduction_Qty" },
          totalSlitDeducted: { $sum: "$slitDB_deduction_Qty" },
        },
      },
    ]).toArray();

    const totalPressDeducted =
      deductionAggregation.length > 0 ? deductionAggregation[0].totalPressDeducted : 0;
    const totalSlitDeducted =
      deductionAggregation.length > 0 ? deductionAggregation[0].totalSlitDeducted : 0;

    // Corrected calculation for pressDB_Remaining_Quantity
    const pressDB_Remaining_Quantity = totalPress - totalPressDeducted;
    const slitDB_Remaining_Quantity = totalSlitInserted - totalSlitDeducted;

    console.log("Total press:", totalPress);
    console.log("Total deducted from pressDB:", totalPressDeducted);
    console.log("Total slit:", totalSlitInserted);
    console.log("Total deducted from slitDB:", totalSlitDeducted);

    // Step 6: Update pressDB_Remaining_Quantity and slitDB_Remaining_Quantity in currentCountDB
    const currentCountEntry = await currentCountDB.findOne({ uniqueID });

    if (!currentCountEntry) {
      return res.status(404).json({ error: "UniqueID not found in currentCountDB" });
    }

    await currentCountDB.updateOne(
      { uniqueID },
      {
        $set: {
          pressDB_Remaining_Quantity, // Update calculated pressDB remaining quantity
          slitDB_Remaining_Quantity, // Update calculated slitDB remaining quantity
          ScannedQR, // Add or update ScannedQR
          pressDB_Date: Date, // Update or add Date
        },
      }
    );

    res.status(201).json({ insertedId: result.insertedId, message: 'Form submitted and updated successfully' });
  } catch (error) {
    console.error('Error processing submitToSlitDB:', error);
    res.status(500).send('Error processing submission to slitDB');
  }
});



////////////////////
//KENSA route
////////////////////

// Kensa scan-button
app.post('/processKensa', async (req, res) => {
  try {
    const { ScannedQR } = req.body;

    if (!ScannedQR) {
      return res.status(400).json({ error: "ScannedQR is required" });
    }

    console.log(`Processing Kensa QR: ${ScannedQR}`);

    await client.connect();
    const submittedDB = client.db("submittedDB");
    const pressDB = submittedDB.collection("pressDB");
    const currentCountDB = submittedDB.collection("currentCountDB");

    // Step 1: Find the row in pressDB with ScannedQR and Process_Status = "processing"
    const pressEntry = await pressDB.findOne({ ScannedQR, Process_Status: "processing" });

    if (!pressEntry) {
      return res.status(404).json({ error: "QR not found or not in processing state in pressDB" });
    }

    const { 背番号, uniqueID } = pressEntry;

    // Step 2: Check masterDB for the 背番号
    const masterDB = client.db("Sasaki_Coating_MasterDB").collection("masterDB");
    const masterEntries = await masterDB.findOne({ 背番号 });
    

    if (masterEntries.length === 0) {
      return res.status(404).json({ error: "背番号 not found in masterDB" });
    }

    

    const { SLIT, SRS } = masterEntries;
    
    console.log(`SRS from DB: '${masterEntries.SRS}'`);
    console.log(`SLIT from DB: '${masterEntries.SLIT}'`);
    console.log(`Type of SRS: ${typeof masterEntries.SRS}`);
    console.log(`Type of SLIT: ${typeof masterEntries.SLIT}`);  

    // Step 3: Determine source and remaining quantity
    let Remaining_Quantity = 0;
    let source = "";

    if (SLIT === "有り" && SRS === "有り") {
      // Use SRSDB_Remaining_Quantity
      const currentCountEntry = await currentCountDB.findOne({ uniqueID });

      if (!currentCountEntry) {
        return res.status(400).json({ error: "No current count data found for SRS." });
      }

      const { SRSDB_Remaining_Quantity } = currentCountEntry;

      if (SRSDB_Remaining_Quantity === 0) {
        return res.status(400).json({ error: "No remaining quantity in SRSDB. Process completed." });
      }

      Remaining_Quantity = SRSDB_Remaining_Quantity;
      source = "SRSDB";

    } else if (SLIT === "有り" && (!SRS || SRS === "無し")) {
      // Use slitDB_Remaining_Quantity
      const currentCountEntry = await currentCountDB.findOne({ uniqueID });

      if (!currentCountEntry) {
        return res.status(400).json({ error: "No current count data found for SLIT." });
      }

      const { slitDB_Remaining_Quantity } = currentCountEntry;

      if (slitDB_Remaining_Quantity === 0) {
        return res.status(400).json({ error: "No remaining quantity in SLITDB. Process completed." });
      }

      Remaining_Quantity = slitDB_Remaining_Quantity;
      source = "slitDB";

    } else if ((!SLIT || SLIT === "無し") && SRS === "有り") {
      // Use SRSDB_Remaining_Quantity
      const currentCountEntry = await currentCountDB.findOne({ uniqueID });

      if (!currentCountEntry) {
        return res.status(400).json({ error: "No current count data found for SRS." });
      }

      const { SRSDB_Remaining_Quantity } = currentCountEntry;

      if (SRSDB_Remaining_Quantity === 0) {
        return res.status(400).json({ error: "No remaining quantity in SRSDB. Process completed." });
      }

      Remaining_Quantity = SRSDB_Remaining_Quantity;
      source = "SRSDB";

    } else if ((!SLIT || SLIT === "無し") && (!SRS || SRS === "無し")) {
      // Use pressDB_Remaining_Quantity
      const currentCountEntryPress = await currentCountDB.findOne({ uniqueID });
      if (currentCountEntryPress === 0) {
        return res.status(400).json({ error: "No remaining quantity in pressDB. Process completed." });
      }
      const { pressDB_Remaining_Quantity } = currentCountEntryPress;

      Remaining_Quantity = pressDB_Remaining_Quantity;
      source = "pressDB";

    } else {
      return res.status(400).json({ error: "Invalid process configuration for Kensa" });
    }

    return res.json({
      uniqueID,
      Remaining_Quantity,
      背番号,
      source,
    });
  } catch (error) {
    console.error("Error processing Kensa QR:", error);
    res.status(500).send("Error processing Kensa QR.");
  }
});




// Submit data to kensaDB and update currentCountDB
app.post('/submitToKensaDB', async (req, res) => {
  try {
    const formData = req.body;
    const { uniqueID, Total, 設備, Total_NG, ScannedQR, Date, Worker_Name } = formData;

    await client.connect();
    const database = client.db('submittedDB');
    const kensaDB = database.collection('kensaDB');
    const currentCountDB = database.collection('currentCountDB');
    const pressDB = database.collection('pressDB'); // Add pressDB collection
    const deductionLogDB = database.collection('deduction_LogDB'); // Deduction Log collection

    // Step 1: Insert the new record into kensaDB
    const result = await kensaDB.insertOne(formData);

    // Step 2: Aggregate total process quantity in kensaDB
    const kensaAggregation = await kensaDB.aggregate([
      { $match: { uniqueID } },
      { $group: { _id: "$uniqueID", totalProcessQuantity: { $sum: "$Total" } } },
    ]).toArray();

    if (kensaAggregation.length === 0) {
      return res.status(404).json({ error: "No records found in kensaDB for this uniqueID" });
    }

    const totalKensaProcessed = kensaAggregation[0].totalProcessQuantity;

    // Step 3: Fetch current counts from currentCountDB
    const currentCountEntry = await currentCountDB.findOne({ uniqueID });

    if (!currentCountEntry) {
      return res.status(404).json({ error: "UniqueID not found in currentCountDB" });
    }

    const { SRSDB_Remaining_Quantity, slitDB_Remaining_Quantity, pressDB_Remaining_Quantity } =
      currentCountEntry;

    // Step 4: Fetch the masterDB entry for SRS and SLIT checks
    const masterDB = client.db('Sasaki_Coating_MasterDB').collection('masterDB');
    const masterEntry = await masterDB.findOne({ 背番号: currentCountEntry.背番号 });

    if (!masterEntry) {
      return res.status(404).json({ error: "背番号 not found in masterDB" });
    }

    const { SRS, SLIT } = masterEntry;

    // Calculate the deduction quantity
    const deductionQty = Total + Total_NG;

    // Insert into deduction_LogDB
    const now = new global.Date();
    const deductionData = {
      uniqueID,
      Date: now.toISOString().split('T')[0], // YYYY-MM-DD
      Time: now.toTimeString().split(' ')[0], // HH:mm:ss
      Name: Worker_Name, // Replace with appropriate worker name if needed
      Log: `Total:${Total}, Total_NG:${Total_NG} from ${設備}`,
    };

    // Step 5: Backward checking and deduction logic
    if (SRS === '有り') {
      // Deduct from SRSDB_Remaining_Quantity
      const updatedSRSQuantity = SRSDB_Remaining_Quantity - deductionQty;

      if (updatedSRSQuantity < 0) {
        return res.status(400).json({ error: "Not enough quantity in SRSDB to process this submission" });
      }

      deductionData.SRSDB_deduction_Qty = deductionQty;
      await deductionLogDB.insertOne(deductionData);

      await currentCountDB.updateOne(
        { uniqueID },
        {
          $set: {
            SRSDB_Remaining_Quantity: updatedSRSQuantity,
            kensaDB_Total_Processed: totalKensaProcessed,
          },
        }
      );
    } else if (SLIT === '有り') {
      // Deduct from slitDB_Remaining_Quantity
      const updatedSlitQuantity = slitDB_Remaining_Quantity - deductionQty;

      if (updatedSlitQuantity < 0) {
        return res.status(400).json({ error: "Not enough quantity in slitDB to process this submission" });
      }

      deductionData.slitDB_deduction_Qty = deductionQty;
      await deductionLogDB.insertOne(deductionData);

      await currentCountDB.updateOne(
        { uniqueID },
        {
          $set: {
            slitDB_Remaining_Quantity: updatedSlitQuantity,
            kensaDB_Total_Processed: totalKensaProcessed,
          },
        }
      );
    } else {
      // Deduct from pressDB_Remaining_Quantity
      const updatedPressQuantity = pressDB_Remaining_Quantity - deductionQty;

      if (updatedPressQuantity < 0) {
        return res.status(400).json({ error: "Not enough quantity in pressDB to process this submission" });
      }

      deductionData.pressDB_deduction_Qty = deductionQty;
      await deductionLogDB.insertOne(deductionData);

      await currentCountDB.updateOne(
        { uniqueID },
        {
          $set: {
            pressDB_Remaining_Quantity: updatedPressQuantity,
            kensaDB_Total_Processed: totalKensaProcessed,
          },
        }
      );
    }

    // Step 6: Check if all remaining quantities are zero
    const updatedCurrentCount = await currentCountDB.findOne({ uniqueID });
    const {
      SRSDB_Remaining_Quantity: updatedSRSDB_Remaining_Quantity,
      slitDB_Remaining_Quantity: updatedSlitDB_Remaining_Quantity,
      pressDB_Remaining_Quantity: updatedPressDB_Remaining_Quantity,
    } = updatedCurrentCount;

    const totalRemainingQuantity =
      updatedSRSDB_Remaining_Quantity +
      updatedSlitDB_Remaining_Quantity +
      updatedPressDB_Remaining_Quantity;

    if (totalRemainingQuantity === 0) {
      // Update Process_Status in pressDB to "completed"
      await pressDB.updateOne(
        { uniqueID },
        {
          $set: {
            Process_Status: "completed",
          },
        }
      );
    }

    res.status(201).json({ insertedId: result.insertedId, message: "Form submitted and updated successfully" });
  } catch (error) {
    console.error("Error saving to kensaDB:", error);
    res.status(500).send("Error saving to kensaDB");
  }
});



// THis code updates remaining quantity
//update Remaining_Quantity column for either slitDB or pressDB
app.post('/updateRemainingQuantity', async (req, res) => {
  try {
    const { source, Remaining_Quantity, uniqueID } = req.body;

    if (!source || !uniqueID) {
      return res.status(400).json({ error: 'Source and uniqueID are required' });
    }

    await client.connect();
    const database = client.db('submittedDB');
    const collection = database.collection(source); // Either slitDB or pressDB

    // Update the Remaining_Quantity for the matching uniqueID
    const result = await collection.updateOne(
      { uniqueID }, // Match by uniqueID
      { $set: { Remaining_Quantity } }
    );

    if (result.matchedCount === 0) {
      console.log(`UniqueID ${uniqueID} not found in ${source}`);
      return res.status(404).json({ error: `UniqueID ${uniqueID} not found in ${source}` });
    }

    res.status(200).json({ message: 'Remaining Quantity updated successfully' });
  } catch (error) {
    console.error('Error updating Remaining Quantity:', error);
    res.status(500).send('Error updating Remaining Quantity');
  }
});


app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});